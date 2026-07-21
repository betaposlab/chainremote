// ★ 적대적 테스트 — 토큰 롤링 재발급 + 정지 tenant 401 흐름 (좀비 로그인 봉인, 1.4.65).
//
// 대상:
//   - lib/api-auth.ts        : needsTokenRefresh(순수 경계) / verifyApiToken(서명·alg·iss·aud) / requireApiAuth(파서+정지검사)
//   - app/api/auth/heartbeat : 만료임박 토큰 롤링 재발급 + 좌석(REVOKED) 게이트 + super_admin 예외
//
// 실 코드(lib/**, app/**)는 절대 수정하지 않는다 — 새 테스트 파일만.
// pglite 실스키마 + 실 라우트 핸들러 직접 호출(목킹 아님). 토큰은 jose 로 임의 exp/jti/iss/aud/alg
// 를 박아 만든다(signApiToken 은 24h 고정이라 만료·만료임박 케이스를 만들 수 없기 때문).

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

// signApiToken/verifyApiToken 이 AUTH_SECRET 을 읽으므로 어떤 모듈 import 보다 먼저(setup 이
// 이미 세팅하지만 방어적으로). 아래 craftToken 도 같은 process.env.AUTH_SECRET 을 쓴다.
process.env.AUTH_SECRET ||= "test-secret-token-refresh-adv";

import { SignJWT } from "jose";
import { testDb } from "./helpers/db";
import { tenants, users, activeLoginSessions } from "@/lib/schema";
import { needsTokenRefresh, signApiToken, verifyApiToken } from "@/lib/api-auth";
import { POST as heartbeatPOST } from "@/app/api/auth/heartbeat/route";

// verifyApiToken 이 검증하는 발행/청중(api-auth.ts 상수와 일치해야 통과).
const ISSUER = "chainremote-admin";
const AUDIENCE = "chainremote-desktop";

type Role = "owner" | "admin" | "operator" | "viewer" | "super_admin";
interface Claims {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  tenantId: string;
}

const nowSec = () => Math.floor(Date.now() / 1000);

async function makeTenant(
  slug: string,
  opts: { subscriptionStatus?: "active" | "suspended" | "cancelled"; isActive?: boolean } = {},
): Promise<string> {
  const [t] = await testDb()
    .insert(tenants)
    .values({
      slug,
      displayName: slug,
      isActive: opts.isActive ?? true,
      subscriptionStatus: opts.subscriptionStatus ?? "active",
    })
    .returning({ id: tenants.id });
  return t.id;
}

async function makeUser(tenantId: string, email: string, role: Role = "owner"): Promise<string> {
  const [u] = await testDb()
    .insert(users)
    .values({ tenantId, email, passwordHash: "x", displayName: email, role, isActive: true })
    .returning({ id: users.id });
  return u.id;
}

// active_login_sessions 좌석 행을 특정 jti 로 직접 심는다(claimSeat 은 jti 를 스스로 생성해
// 토큰 jti 와 못 맞추므로). jti 컬럼은 uuid.
async function seatRow(userId: string, jti: string, deviceId = "DEV-A"): Promise<void> {
  await testDb()
    .insert(activeLoginSessions)
    .values({ userId, jti, deviceId, deviceLabel: deviceId, ip: null });
}

async function seatCount(userId: string): Promise<number> {
  const rows = await testDb().select().from(activeLoginSessions);
  return rows.filter((r) => r.userId === userId).length;
}

// 임의 exp/jti/iss/aud/alg/secret 로 서명한 토큰(만료·만료임박·위조를 만들기 위함).
async function craftToken(
  claims: Claims,
  opts: {
    exp: number;
    jti?: string;
    iss?: string;
    aud?: string;
    secret?: string;
  },
): Promise<string> {
  const secret = new TextEncoder().encode(opts.secret ?? process.env.AUTH_SECRET!);
  let b = new SignJWT({ ...claims, exp: opts.exp, iat: nowSec() - 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE);
  if (opts.jti) b = b.setJti(opts.jti);
  return b.sign(secret);
}

// alg:"none" 위조 토큰 — jose 는 none 서명을 못 만들므로 수작업 조립(서명부 빈 문자열).
function craftAlgNone(claims: Claims, exp: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = { alg: "none", typ: "JWT" };
  const payload = { ...claims, iss: ISSUER, aud: AUDIENCE, exp, iat: nowSec() - 1 };
  return `${b64(header)}.${b64(payload)}.`;
}

function hbReq(authHeader?: string, body = "{}"): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authHeader !== undefined) headers.authorization = authHeader;
  return new Request("http://t/api/auth/heartbeat", { method: "POST", headers, body });
}

// ─────────────────────────────────────────────────────────────────────────────
// TR-01/02 — needsTokenRefresh 순수 경계 (임계값·NaN/Infinity/문자열)
// ─────────────────────────────────────────────────────────────────────────────
describe("needsTokenRefresh — 임계값·기형 exp", () => {
  const now = 1_800_000_000;
  const HALF = 60 * 60 * 12; // 43200

  it("TR-01: 정확히 12h(43200) 잔여는 유지(false), 43199 는 재발급(true) — < vs <= 부호 회귀", () => {
    expect(needsTokenRefresh(now + HALF, now)).toBe(false); // 43200 < 43200 = false
    expect(needsTokenRefresh(now + HALF - 1, now)).toBe(true); // 43199 < 43200 = true
    expect(needsTokenRefresh(now + HALF + 1, now)).toBe(false); // 43201 = 여유
  });

  it("TR-02: NaN→false, Infinity→false, -Infinity→true, 숫자형 문자열→false(타입가드), null/객체→false", () => {
    expect(needsTokenRefresh(Number.NaN, now)).toBe(false); // NaN 비교는 항상 false
    expect(needsTokenRefresh(Number.POSITIVE_INFINITY, now)).toBe(false); // 무한 잔여 = 재발급 불필요
    expect(needsTokenRefresh(Number.NEGATIVE_INFINITY, now)).toBe(true); // 이미 만료 취급
    expect(needsTokenRefresh("43200", now)).toBe(false); // typeof !== "number"
    expect(needsTokenRefresh(null, now)).toBe(false);
    expect(needsTokenRefresh({}, now)).toBe(false);
    expect(needsTokenRefresh(undefined, now)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 좌석 있는 유효 토큰 흐름 (TR-03/04/05/08) — 롤링 재발급의 핵심 계약
// ─────────────────────────────────────────────────────────────────────────────
describe("heartbeat 롤링 재발급 — 좌석·만료 상태별", () => {
  it("TR-03: 이미 만료된 토큰 → 401(무음 재발급/ revoked 없음) [좀비 봉인 정의적 케이스]", async () => {
    const tid = await makeTenant("tr03");
    const uid = await makeUser(tid, "tr03@x");
    const jti = randomUUID();
    await seatRow(uid, jti); // 좌석은 존재해도 verify 가 먼저 만료로 거른다
    const token = await craftToken(
      { uid, email: "tr03@x", displayName: "u", role: "owner", tenantId: tid },
      { exp: nowSec() - 60, jti },
    );
    const res = await heartbeatPOST(hbReq(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.token).toBeUndefined(); // 만료 좀비를 롤링으로 되살리지 않는다
    expect(j.revoked).toBeUndefined(); // revoked 아님 → 앱은 이 401 을 재로그인으로 처리
  });

  it("TR-04: 만료임박(<12h)+좌석 → 200 + 재발급 토큰 실제 전달, 같은 jti, 새 exp≈+24h", async () => {
    const tid = await makeTenant("tr04");
    const uid = await makeUser(tid, "tr04@x");
    const jti = randomUUID();
    await seatRow(uid, jti);
    const before = nowSec();
    const token = await craftToken(
      { uid, email: "tr04@x", displayName: "u", role: "owner", tenantId: tid },
      { exp: before + 3600, jti },
    );
    const res = await heartbeatPOST(hbReq(`Bearer ${token}`));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(typeof j.token).toBe("string"); // 롤링 토큰을 실제로 실어보낸다
    const reissued = await verifyApiToken(j.token); // 재검증 통과
    expect(reissued.jti).toBe(jti); // 좌석 행 그대로 유효(같은 jti)
    expect(reissued.exp! - before).toBeGreaterThan(60 * 60 * 23); // 원본(+1h)보다 훨씬 미래
    expect(reissued.exp! - before).toBeLessThanOrEqual(60 * 60 * 24 + 5);
    expect(await seatCount(uid)).toBe(1); // 좌석 보존(중복행 없음)
  });

  it("TR-05: 축출된 좌석(jti 행 없음)+만료임박 → 401 REVOKED, 재발급 토큰 누출 없음", async () => {
    const tid = await makeTenant("tr05");
    const uid = await makeUser(tid, "tr05@x");
    const jti = randomUUID();
    // 좌석 행을 심지 않는다 = takeover 로 축출된 상태
    const token = await craftToken(
      { uid, email: "tr05@x", displayName: "u", role: "owner", tenantId: tid },
      { exp: nowSec() + 3600, jti },
    );
    const res = await heartbeatPOST(hbReq(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.revoked).toBe(true); // 인계당함
    expect(j.token).toBeUndefined(); // ★롤링 재발급으로 takeover 우회 불가(재발급이 REVOKED 보다 먼저 계산돼도 안 샌다)
  });

  it("TR-08: 잔여 ≥12h(now+13h)+좌석 → 200 {ok:true}, 재발급 토큰 없음(헛발급 억제)", async () => {
    const tid = await makeTenant("tr08");
    const uid = await makeUser(tid, "tr08@x");
    const jti = randomUUID();
    await seatRow(uid, jti);
    const token = await craftToken(
      { uid, email: "tr08@x", displayName: "u", role: "owner", tenantId: tid },
      { exp: nowSec() + 60 * 60 * 13, jti },
    );
    const res = await heartbeatPOST(hbReq(`Bearer ${token}`));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.token).toBeUndefined(); // needsTokenRefresh=false → refreshed 없음
  });

  it("TR-14: 만료임박 토큰 병렬 heartbeat 2건 — 둘 다 200+유효 재발급(같은 jti), 좌석 1행 유지", async () => {
    const tid = await makeTenant("tr14");
    const uid = await makeUser(tid, "tr14@x");
    const jti = randomUUID();
    await seatRow(uid, jti);
    const token = await craftToken(
      { uid, email: "tr14@x", displayName: "u", role: "owner", tenantId: tid },
      { exp: nowSec() + 3600, jti },
    );
    const [r1, r2] = await Promise.all([
      heartbeatPOST(hbReq(`Bearer ${token}`)),
      heartbeatPOST(hbReq(`Bearer ${token}`)),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
    const c1 = await verifyApiToken(j1.token);
    const c2 = await verifyApiToken(j2.token);
    expect(c1.jti).toBe(jti);
    expect(c2.jti).toBe(jti);
    expect(await seatCount(uid)).toBe(1); // 병렬 롤링이 좌석을 깨거나 중복행을 만들지 않음
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 정지 tenant / super_admin 예외 (TR-09/10) — 재발급 누출 표면
// ─────────────────────────────────────────────────────────────────────────────
describe("정지 tenant × 롤링 재발급 누출 차단", () => {
  it("TR-09: suspended tenant owner + 만료임박 → 401(재발급 도달 전 차단), token 없음", async () => {
    const tid = await makeTenant("tr09", { subscriptionStatus: "suspended" });
    const uid = await makeUser(tid, "tr09@x");
    const jti = randomUUID();
    await seatRow(uid, jti); // 좌석 있어도 정지가 먼저 막는다
    const token = await craftToken(
      { uid, email: "tr09@x", displayName: "u", role: "owner", tenantId: tid },
      { exp: nowSec() + 3600, jti },
    );
    const res = await heartbeatPOST(hbReq(`Bearer ${token}`));
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.token).toBeUndefined(); // 정지 계정엔 재발급 토큰이 절대 안 샌다
    expect(j.error).toContain("정지");
  });

  it("TR-10: suspended tenant super_admin + 만료임박 → 200 + 재발급 토큰(자기잠금 방지 예외 일관)", async () => {
    const tid = await makeTenant("tr10", { subscriptionStatus: "suspended" });
    const uid = await makeUser(tid, "tr10@x", "super_admin");
    const jti = randomUUID();
    await seatRow(uid, jti);
    const token = await craftToken(
      { uid, email: "tr10@x", displayName: "u", role: "super_admin", tenantId: tid },
      { exp: nowSec() + 3600, jti },
    );
    const res = await heartbeatPOST(hbReq(`Bearer ${token}`));
    expect(res.status).toBe(200); // requireApiAuth·라우트 둘 다 super_admin 우회
    const j = await res.json();
    expect(typeof j.token).toBe("string");
    const reissued = await verifyApiToken(j.token);
    expect(reissued.role).toBe("super_admin"); // 정지여도 본사 세션 무한 유지
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 위조 토큰 방어 (TR-11/12/13)
// ─────────────────────────────────────────────────────────────────────────────
describe("위조/기형 토큰 방어", () => {
  it("TR-11: alg=none 위조 토큰 → 401 (알고리즘 혼동 방어)", async () => {
    const tid = await makeTenant("tr11");
    const uid = await makeUser(tid, "tr11@x");
    const token = craftAlgNone(
      { uid, email: "tr11@x", displayName: "u", role: "owner", tenantId: tid },
      nowSec() + 3600,
    );
    const res = await heartbeatPOST(hbReq(`Bearer ${token}`));
    expect(res.status).toBe(401);
    expect((await res.json()).token).toBeUndefined();
  });

  it("TR-12: 위조 secret / 위조 issuer / 위조 audience → 모두 401", async () => {
    const tid = await makeTenant("tr12");
    const uid = await makeUser(tid, "tr12@x");
    const base: Claims = { uid, email: "tr12@x", displayName: "u", role: "owner", tenantId: tid };
    const exp = nowSec() + 3600;

    const wrongSecret = await craftToken(base, { exp, secret: "totally-different-secret" });
    const wrongIssuer = await craftToken(base, { exp, iss: "evil" });
    const wrongAudience = await craftToken(base, { exp, aud: "evil" });

    for (const bad of [wrongSecret, wrongIssuer, wrongAudience]) {
      const res = await heartbeatPOST(hbReq(`Bearer ${bad}`));
      expect(res.status).toBe(401);
    }
  });

  it("TR-13: Authorization 헤더 파싱 — 무헤더/스킴변형/이중공백", async () => {
    const tid = await makeTenant("tr13");
    const uid = await makeUser(tid, "tr13@x");
    const jti = randomUUID();
    await seatRow(uid, jti);
    // 재발급 안 시키려 24h 정상 토큰(needsTokenRefresh=false → 순수 파서 흐름만 본다).
    const { token } = await signApiToken(
      { uid, email: "tr13@x", displayName: "u", role: "owner", tenantId: tid },
      jti,
    );

    // (a) 헤더 없음 → 401
    expect((await heartbeatPOST(hbReq(undefined))).status).toBe(401);
    // (b) "Bearer"(토큰 없음) → \s+(.+) 불매치 → 401
    expect((await heartbeatPOST(hbReq("Bearer"))).status).toBe(401);
    // (d) "Basic <token>" → 401
    expect((await heartbeatPOST(hbReq(`Basic ${token}`))).status).toBe(401);
    // (c) 소문자 "bearer <token>" → i 플래그로 허용 → 200
    expect((await heartbeatPOST(hbReq(`bearer ${token}`))).status).toBe(200);
    // (e) 이중 공백 "Bearer  <token>" → \s+ 흡수 → 200
    expect((await heartbeatPOST(hbReq(`Bearer  ${token}`))).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★결함 후보 — "의도된 동작과 실제 동작이 어긋남". 소스 수정 금지, 실패 상태로 남겨 보고한다.
//   (여기 실패 = 진짜 결함 신호. 억지 통과시키지 않는다.)
// ─────────────────────────────────────────────────────────────────────────────
describe("★결함 후보 (실패 = 결함 신호)", () => {
  it("TR-06: jti 없는 옛 토큰은 롤링 재발급하면 안 된다(재로그인 강제) — 현재는 무한 재발급됨", async () => {
    const tid = await makeTenant("tr06");
    const uid = await makeUser(tid, "tr06@x");
    // jti 없는(옛 stateless) 만료임박 토큰
    const token = await craftToken(
      { uid, email: "tr06@x", displayName: "u", role: "owner", tenantId: tid },
      { exp: nowSec() + 3600 }, // jti 미지정
    );
    const res = await heartbeatPOST(hbReq(`Bearer ${token}`));
    const j = await res.json();
    // 올바른 동작: jti 없는 토큰은 재발급하지 않고(자연 소멸 → 재로그인으로 jti 획득) seat
    //   enforcement 하에 편입시켜야 한다. 현재 라우트는 needsTokenRefresh 만 보고 jti 없는
    //   토큰도 새 jti-less 토큰으로 무한 갱신 → enforcement 영구 우회(좀비 봉인의 우회로).
    expect(j.token).toBeUndefined();
  });

  it("TR-07: DB role 강등이 재발급 토큰에 반영돼야 한다 — 현재는 옛 owner 클레임을 영구 복사", async () => {
    const tid = await makeTenant("tr07");
    const uid = await makeUser(tid, "tr07@x", "owner");
    const jti = randomUUID();
    await seatRow(uid, jti);
    const token = await craftToken(
      { uid, email: "tr07@x", displayName: "u", role: "owner", tenantId: tid },
      { exp: nowSec() + 3600, jti },
    );
    // DB 에서 owner → viewer 강등(권한 회수).
    await testDb().update(users).set({ role: "viewer" }).where(eq(users.id, uid));

    const res = await heartbeatPOST(hbReq(`Bearer ${token}`));
    expect(res.status).toBe(200);
    const j = await res.json();
    const reissued = await verifyApiToken(j.token);
    // 올바른 동작: 재발급은 현재 권한(viewer)을 반영해야 한다. 현재는 옛 토큰 클레임을 그대로
    //   복사해 role=owner 를 영구화 → requireOwner 게이트를 강등된 계정이 재로그인 전까지 통과.
    expect(reissued.role).toBe("viewer");
  });
});
