import { describe, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { ApiAuthError, requireApiAuth, signApiToken } from "@/lib/api-auth";
import { claimSeat, getActiveSession, takeoverSeat } from "@/lib/data/active-sessions";
import { POST as takeoverPOST } from "@/app/api/auth/takeover/route";
import { POST as tokenPOST } from "@/app/api/auth/token/route";
import { activeLoginSessions, tenants, users } from "@/lib/schema";
import bcrypt from "bcryptjs";

// 2026-08-16 감사(A2) 확정 이슈 수정의 회귀 가드.
//   각 테스트는 "고치기 전이면 실패하고, 고친 뒤에는 통과" 하도록 썼다.
//   원본 진단: docs/chainremote/audit/round1/A2.md

const PW = "1234";
const HASH = bcrypt.hashSync(PW, 4);

async function mkTenant(slug: string, opts?: { maxSeats?: number; suspended?: boolean }) {
  const [t] = await testDb()
    .insert(tenants)
    .values({
      slug,
      displayName: slug,
      maxSeats: opts?.maxSeats ?? 1,
      ...(opts?.suspended ? { subscriptionStatus: "suspended" } : {}),
    })
    .returning({ id: tenants.id });
  return t.id;
}

async function mkUser(
  tenantId: string,
  email: string,
  role: "owner" | "admin" | "operator" | "super_admin" = "owner",
) {
  const [u] = await testDb()
    .insert(users)
    .values({ tenantId, email, displayName: email, passwordHash: HASH, role })
    .returning({ id: users.id });
  return u.id;
}

let ipSeq = 0;
function jsonReq(url: string, body: unknown) {
  // 요청마다 다른 IP — rateLimit 버킷은 모듈 전역이라 테스트가 공유하면 IP 한도(15/분)에
  //   먼저 걸려 엉뚱한 429 가 난다. 실제 사용자도 서로 다른 IP 다.
  ipSeq += 1;
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.0.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`,
    },
    body: JSON.stringify(body),
  });
}

function bearerReq(token: string) {
  return new Request("http://t/api/customers", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("A2-01 takeover 도 대리점 좌석 총량을 본다", () => {
  it("좌석이 다 찼으면 /takeover 직접 호출도 403 — 종전엔 200 이라 좌석 과금을 우회했다", async () => {
    const tid = await mkTenant("seat-cap", { maxSeats: 1 });
    const a = await mkUser(tid, "a@x");
    const b = await mkUser(tid, "b@x");
    // 아이디 A 가 좌석을 쓰는 중.
    await claimSeat({
      userId: a,
      jti: "11111111-1111-4111-8111-111111111111",
      deviceId: "devA",
      deviceLabel: "A",
      ip: null,
    });
    // 아이디 B 가 409 를 안 거치고 takeover 를 직접 친다.
    const res = await takeoverPOST(
      jsonReq("http://t/api/auth/takeover", {
        email: "b@x",
        password: PW,
        deviceId: "devB",
        deviceLabel: "B",
      }),
    );
    expect(res.status).toBe(403);
    // A 의 좌석은 그대로여야 한다.
    expect((await getActiveSession(a))?.deviceId).toBe("devA");
  });

  it("자기 좌석 덮어쓰기(같은 아이디 다른 기기)는 총량이 안 변하므로 통과한다", async () => {
    const tid = await mkTenant("seat-self", { maxSeats: 1 });
    const a = await mkUser(tid, "a@x");
    await claimSeat({
      userId: a,
      jti: "22222222-2222-4222-8222-222222222222",
      deviceId: "old",
      deviceLabel: "old",
      ip: null,
    });
    const res = await takeoverPOST(
      jsonReq("http://t/api/auth/takeover", {
        email: "a@x",
        password: PW,
        deviceId: "new",
        deviceLabel: "new",
      }),
    );
    expect(res.status).toBe(200);
    expect((await getActiveSession(a))?.deviceId).toBe("new");
  });
});

describe("A2-03 인계당한 토큰은 모든 API 에서 즉시 죽는다", () => {
  it("takeover 로 좌석을 뺏기면 옛 토큰의 /api/customers 도 401 revoked — 종전엔 24h 유효", async () => {
    const tid = await mkTenant("revoke-api");
    const uid = await mkUser(tid, "u@x");
    const oldJti = "33333333-3333-4333-8333-333333333333";
    await claimSeat({ userId: uid, jti: oldJti, deviceId: "d1", deviceLabel: "d1", ip: null });
    const { token } = await signApiToken(
      { uid, email: "u@x", displayName: "u", role: "owner", tenantId: tid },
      oldJti,
    );
    // 아직은 통과.
    expect((await requireApiAuth(bearerReq(token))).uid).toBe(uid);

    // 다른 기기가 인계.
    await takeoverSeat({
      userId: uid,
      jti: "44444444-4444-4444-8444-444444444444",
      deviceId: "d2",
      deviceLabel: "d2",
      ip: null,
    });
    const err = await requireApiAuth(bearerReq(token)).catch((e) => e);
    expect(err).toBeInstanceOf(ApiAuthError);
    expect(err.status).toBe(401);
    expect(err.revoked).toBe(true);
  });

  it("로그아웃(좌석 삭제) 뒤에도 옛 토큰은 죽는다", async () => {
    const tid = await mkTenant("revoke-logout");
    const uid = await mkUser(tid, "u@x");
    const jti = "55555555-5555-4555-8555-555555555555";
    await claimSeat({ userId: uid, jti, deviceId: "d", deviceLabel: "d", ip: null });
    const { token } = await signApiToken(
      { uid, email: "u@x", displayName: "u", role: "owner", tenantId: tid },
      jti,
    );
    await testDb().delete(activeLoginSessions).where(eq(activeLoginSessions.userId, uid));
    await expect(requireApiAuth(bearerReq(token))).rejects.toMatchObject({
      status: 401,
      revoked: true,
    });
  });
});

describe("A2-05 role 은 토큰이 아니라 DB 현재값", () => {
  it("강등되면 발급된 토큰의 role 도 즉시 낮게 읽힌다", async () => {
    const tid = await mkTenant("role-live");
    const uid = await mkUser(tid, "u@x", "owner");
    const jti = "66666666-6666-4666-8666-666666666666";
    await claimSeat({ userId: uid, jti, deviceId: "d", deviceLabel: "d", ip: null });
    const { token } = await signApiToken(
      { uid, email: "u@x", displayName: "u", role: "owner", tenantId: tid },
      jti,
    );
    await testDb().update(users).set({ role: "viewer" }).where(eq(users.id, uid));
    const me = await requireApiAuth(bearerReq(token));
    expect(me.role).toBe("viewer"); // 토큰엔 owner 가 들어 있다
  });
});

describe("A2-06 아이디는 대소문자를 가리지 않는다", () => {
  it("'Chang' 으로 만든 계정에 'chang' 으로 로그인된다", async () => {
    const tid = await mkTenant("case-login", { maxSeats: 5 });
    await mkUser(tid, "Chang");
    const res = await tokenPOST(
      jsonReq("http://t/api/auth/token", {
        email: "chang",
        password: PW,
        deviceId: "dev",
        deviceLabel: "mac",
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("A2-08 로그인 잠금은 실패만 센다", () => {
  it("성공이 이어져도 잠기지 않는다 — 종전엔 성공 시도까지 세어 6회면 막혔다", async () => {
    const tid = await mkTenant("rl", { maxSeats: 9999 });
    await mkUser(tid, "rl@x");
    for (let i = 0; i < 10; i++) {
      const res = await tokenPOST(
        jsonReq("http://t/api/auth/token", {
          email: "rl@x",
          password: PW,
          deviceId: `dev${i}`,
          deviceLabel: "d",
        }),
      );
      expect(res.status, `${i}번째 로그인`).not.toBe(429);
    }
  });
});

describe("A2-09 기기 이름 길이 상한", () => {
  it("아주 긴 라벨은 잘려서 저장된다", async () => {
    const tid = await mkTenant("devlen", { maxSeats: 5 });
    const uid = await mkUser(tid, "d@x");
    const res = await tokenPOST(
      jsonReq("http://t/api/auth/token", {
        email: "d@x",
        password: PW,
        deviceId: "x".repeat(5000),
        deviceLabel: "y".repeat(5000),
      }),
    );
    expect(res.status).toBe(200);
    const seat = await getActiveSession(uid);
    expect(seat!.deviceId.length).toBeLessThanOrEqual(128);
    expect(seat!.deviceLabel!.length).toBeLessThanOrEqual(128);
  });
});

describe("A2-04 비번을 바꾸면 좌석이 회수된다", () => {
  it("본인 비번 변경(/api/me/password) 후 좌석이 비어 옛 HQ 가 ~5초 뒤 끊긴다", async () => {
    const { POST: pwdPOST } = await import("@/app/api/me/password/route");
    const tid = await mkTenant("pwd");
    const uid = await mkUser(tid, "p@x", "operator");
    const jti = "77777777-7777-4777-8777-777777777777";
    await claimSeat({ userId: uid, jti, deviceId: "d", deviceLabel: "d", ip: null });
    const { token } = await signApiToken(
      { uid, email: "p@x", displayName: "p", role: "operator", tenantId: tid },
      jti,
    );
    const res = await pwdPOST(
      new Request("http://t/api/me/password", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ currentPassword: PW, newPassword: "newpw1234" }),
      }),
    );
    expect(res.status).toBe(200);
    // 좌석이 비워졌다 → 침입자 HQ 는 다음 heartbeat 에 REVOKED.
    expect(await getActiveSession(uid)).toBeFalsy();
    // 그리고 그 토큰은 이제 어떤 API 도 못 쓴다(A2-03 과 맞물림).
    await expect(requireApiAuth(bearerReq(token))).rejects.toMatchObject({
      status: 401,
      revoked: true,
    });
  });
});

describe("A2-07 정지된 대리점은 패널도 즉시 막힌다", () => {
  // ★패널(getLiveUser) 쪽은 vitest 에서 검증할 수 없다 — next-auth 가 next/server 를
  //   끌어와 import 자체가 안 된다. 브라우저로 실제 확인한다(정지 대리점 계정으로 로그인 →
  //   /customers 가 /login 으로 튕기는지). 아래는 같은 판정을 쓰는 HQ 관문 쪽 검증이다.
  it("정지 대리점은 heartbeat·리소스 API 도 막는다(관문 일치)", async () => {
    const tid = await mkTenant("susp2", { suspended: true });
    const uid = await mkUser(tid, "u@x", "owner");
    const jti = "88888888-8888-4888-8888-888888888888";
    await claimSeat({ userId: uid, jti, deviceId: "d", deviceLabel: "d", ip: null });
    const { token } = await signApiToken(
      { uid, email: "u@x", displayName: "u", role: "owner", tenantId: tid },
      jti,
    );
    const err = await requireApiAuth(bearerReq(token)).catch((e) => e);
    expect(err.status).toBe(401);
    expect(String(err.message)).toContain("정지");
  });
});

describe("좌석 대조가 정상 흐름을 막지 않는다(회귀 방지)", () => {
  it("갓 로그인한 토큰은 모든 API 를 통과한다", async () => {
    const tid = await mkTenant("happy", { maxSeats: 5 });
    await mkUser(tid, "h@x");
    const res = await tokenPOST(
      jsonReq("http://t/api/auth/token", {
        email: "h@x",
        password: PW,
        deviceId: "dev",
        deviceLabel: "win",
      }),
    );
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const me = await requireApiAuth(bearerReq(token));
    expect(me.tenantId).toBe(tid);
  });

  it("jti 없는 옛 토큰은 좌석 대조를 건너뛴다(§8 백워드 호환)", async () => {
    const tid = await mkTenant("legacy");
    const uid = await mkUser(tid, "l@x");
    const { token } = await signApiToken({
      uid,
      email: "l@x",
      displayName: "l",
      role: "owner",
      tenantId: tid,
    });
    const me = await requireApiAuth(bearerReq(token));
    expect(me.uid).toBe(uid);
    expect(await getActiveSession(uid)).toBeFalsy();
  });
});

describe("A2 회귀 — 좌석 총량은 여전히 지켜진다", () => {
  it("/token 은 좌석이 차면 403", async () => {
    const tid = await mkTenant("cap2", { maxSeats: 1 });
    const a = await mkUser(tid, "a@x");
    await mkUser(tid, "b@x");
    await claimSeat({
      userId: a,
      jti: "99999999-9999-4999-8999-999999999999",
      deviceId: "dA",
      deviceLabel: "A",
      ip: null,
    });
    const res = await tokenPOST(
      jsonReq("http://t/api/auth/token", {
        email: "b@x",
        password: PW,
        deviceId: "dB",
        deviceLabel: "B",
      }),
    );
    expect(res.status).toBe(403);
    void sql;
  });
});
