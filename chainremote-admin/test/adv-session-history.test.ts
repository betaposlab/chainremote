// 적대적 테스트 — HQ 지원기록(세션 시작/종료/discard, 내부기기 스킵, remoteId 매칭).
//
// 노림수: 멀티테넌트 격리(남의 세션 end/discard/열람 차단), remoteId 전역유니크 격리,
//   start 아이덴포턴시/다운그레이드, 악성입력(비UUID path, NUL바이트, SQL 특수문자),
//   무인증/위조/정지테넌트 차단, 삭제거래처 orphan 세션 조회 비대칭.
//
// ★소스는 절대 수정하지 않는다. "의도≠실제" 로 실패하는 케이스는 [결함 후보] describe 에
//   실패 상태로 남긴다(억지 통과 금지). 나머지는 현 계약을 못박아 통과시킨다.

import { describe, it, expect } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { SignJWT } from "jose";

import { testDb } from "./helpers/db";
import { tenants, users, customers, supportSessions } from "@/lib/schema";
import { signApiToken } from "@/lib/api-auth";
import {
  startSession,
  endSession,
  discardSession,
  listCustomerSessions,
  listRecentSessions,
} from "@/lib/data/sessions";
import { POST as startRoute } from "@/app/api/sessions/route";
import { POST as endRoute } from "@/app/api/sessions/[id]/end/route";
import { POST as discardRoute } from "@/app/api/sessions/[id]/discard/route";
import { GET as custSessRoute } from "@/app/api/customers/[id]/sessions/route";
import { GET as recentRoute } from "@/app/api/sessions/recent/route";

type Role = "owner" | "admin" | "operator" | "viewer" | "super_admin";
const NUL = String.fromCharCode(0);
const RANDOM_UUID = "00000000-0000-4000-8000-000000000000";

// ── 시드 헬퍼 ─────────────────────────────────────────────────────────────
async function mkTenant(
  slug: string,
  opts: { isActive?: boolean; subscriptionStatus?: "active" | "suspended" | "cancelled" } = {},
): Promise<string> {
  const db = testDb();
  const [t] = await db
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

async function mkUser(
  tenantId: string,
  email: string,
  displayName: string,
  role: Role = "operator",
): Promise<string> {
  const db = testDb();
  const [u] = await db
    .insert(users)
    .values({ tenantId, email, displayName, passwordHash: "x", role })
    .returning({ id: users.id });
  return u.id;
}

async function mkCustomer(
  tenantId: string,
  name: string,
  remoteId: string,
  opts: { isInternal?: boolean } = {},
): Promise<string> {
  const db = testDb();
  const [c] = await db
    .insert(customers)
    .values({ tenantId, name, remoteId, isInternal: opts.isInternal ?? false })
    .returning({ id: customers.id });
  return c.id;
}

async function bearer(uid: string, tenantId: string, role: Role = "operator"): Promise<string> {
  const { token } = await signApiToken(
    { uid, email: `${uid}@x`, displayName: uid, role, tenantId },
    // jti 는 좌석 enforcement 용 — 세션 라우트엔 무관하나 실 발급과 동일하게 박아둔다.
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  );
  return token;
}

// ── Request/ctx 빌더 ──────────────────────────────────────────────────────
function ctxOf(id: string) {
  return { params: Promise.resolve({ id }) };
}
function authPost(url: string, tok: string | null, bodyObj?: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tok) headers.authorization = `Bearer ${tok}`;
  return new Request(url, { method: "POST", headers, body: JSON.stringify(bodyObj ?? {}) });
}
function authPostRaw(url: string, tok: string | null, rawBody: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tok) headers.authorization = `Bearer ${tok}`;
  return new Request(url, { method: "POST", headers, body: rawBody });
}
function authGet(url: string, tok: string | null): Request {
  const headers: Record<string, string> = {};
  if (tok) headers.authorization = `Bearer ${tok}`;
  return new Request(url, { method: "GET", headers });
}

// ── DB 조회 헬퍼 ──────────────────────────────────────────────────────────
async function row(id: string) {
  const db = testDb();
  const [r] = await db.select().from(supportSessions).where(eq(supportSessions.id, id)).limit(1);
  return r;
}
async function activeCount(operatorId: string, customerId: string): Promise<number> {
  const db = testDb();
  const rows = await db
    .select()
    .from(supportSessions)
    .where(
      and(
        eq(supportSessions.operatorId, operatorId),
        eq(supportSessions.customerId, customerId),
        isNull(supportSessions.endedAt),
      ),
    );
  return rows.length;
}
async function totalSessions(): Promise<number> {
  const db = testDb();
  return (await db.select().from(supportSessions)).length;
}

// 정상 단일 테넌트 시드 (op + customer remoteId 323608526).
async function seedOne(slug = "one") {
  const tenantId = await mkTenant(slug);
  const operatorId = await mkUser(tenantId, "op@x", "재성", "operator");
  const customerId = await mkCustomer(tenantId, "도덕봉가든", "323608526");
  return { tenantId, operatorId, customerId };
}

// ════════════════════════════════════════════════════════════════════════
// 멀티테넌트 격리 (통과 기대)
// ════════════════════════════════════════════════════════════════════════
describe("멀티테넌트 격리 — 남의 세션은 못 건드린다", () => {
  it("S1 다른 테넌트의 end 는 무변경 (데이터레이어 + 라우트 둘 다)", async () => {
    const A = await mkTenant("s1a");
    const opA = await mkUser(A, "opA@x", "체인A");
    const cA = await mkCustomer(A, "가든", "323608526");
    const B = await mkTenant("s1b");
    const opB = await mkUser(B, "opB@x", "체인B");
    const sess = await startSession({ tenantId: A, operatorId: opA, customerId: cA, remoteId: "323608526" });

    // (1) 데이터레이어 직접: WHERE id AND tenantId=B → 0행.
    await endSession(sess.id, B, { resolution: "resolved", description: "해킹" });
    let r = await row(sess.id);
    expect(r.endedAt).toBeNull();
    expect(r.resolution).toBe("in_progress");
    expect(r.description).toBeNull();

    // (2) 라우트(B 토큰): 존재 은닉으로 ok:true 를 줄지언정 A 의 row 는 불변이어야 한다.
    const tokB = await bearer(opB, B);
    const res = await endRoute(
      authPost(`http://t/api/sessions/${sess.id}/end`, tokB, { resolution: "resolved", description: "해킹2" }),
      ctxOf(sess.id),
    );
    expect(res.status).toBe(200);
    r = await row(sess.id);
    expect(r.endedAt).toBeNull();
    expect(r.resolution).toBe("in_progress");
    expect(r.description).toBeNull();
  });

  it("S2 다른 테넌트의 discard 는 세션을 못 지운다 (살아남음)", async () => {
    const A = await mkTenant("s2a");
    const opA = await mkUser(A, "opA@x", "체인A");
    const cA = await mkCustomer(A, "가든", "323608526");
    const B = await mkTenant("s2b");
    const opB = await mkUser(B, "opB@x", "체인B");
    const sess = await startSession({ tenantId: A, operatorId: opA, customerId: cA, remoteId: "323608526" });

    // 데이터레이어
    await discardSession(sess.id, B);
    expect(await row(sess.id)).toBeDefined();

    // 라우트(B 토큰) — UUID 를 추측해도 남의 이력을 파괴할 수 없어야 한다.
    const tokB = await bearer(opB, B);
    const res = await discardRoute(authPost(`http://t/api/sessions/${sess.id}/discard`, tokB), ctxOf(sess.id));
    expect(res.status).toBe(200);
    expect(await row(sess.id)).toBeDefined();
  });

  it("S3 다른 테넌트가 남의 거래처 지원이력을 열람하면 빈 결과(누출 0)", async () => {
    const A = await mkTenant("s3a");
    const opA = await mkUser(A, "opA@x", "체인A");
    const cA = await mkCustomer(A, "가든", "323608526");
    const B = await mkTenant("s3b");
    const opB = await mkUser(B, "opB@x", "체인B");
    const sess = await startSession({ tenantId: A, operatorId: opA, customerId: cA, remoteId: "323608526" });
    await endSession(sess.id, A, { description: "카드단말 재연결", contactName: "김점장" });

    // 데이터레이어: customerId AND tenantId=B → 0행.
    expect((await listCustomerSessions(cA, B)).length).toBe(0);

    // 라우트(B 토큰, A 의 customer UUID 추측).
    const tokB = await bearer(opB, B);
    const res = await custSessRoute(authGet(`http://t/api/customers/${cA}/sessions`, tokB), ctxOf(cA));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.sessions.length).toBe(0);
    // 응대자·내용이 응답 어디에도 새면 안 된다.
    expect(JSON.stringify(j)).not.toContain("김점장");
    expect(JSON.stringify(j)).not.toContain("카드단말");
  });

  it("S4 다른 테넌트 거래처의 remoteId 로 start → skipped:unknown, 세션 미생성, 이름 누출 0", async () => {
    const A = await mkTenant("s4a");
    const opA = await mkUser(A, "opA@x", "체인A");
    await mkCustomer(A, "비밀상호가든", "323608526"); // 전역 유니크라 B 는 같은 값 불가.
    const B = await mkTenant("s4b");
    const opB = await mkUser(B, "opB@x", "체인B");

    const tokB = await bearer(opB, B);
    const res = await startRoute(authPost("http://t/api/sessions", tokB, { remoteId: "323608526" }));
    const j = await res.json();
    expect(j.sessionId).toBeNull();
    expect(j.skipped).toBe("unknown"); // A 의 존재와 구분 불가여야 격리 성립.
    expect(await totalSessions()).toBe(0); // 세션 row 안 생김.
    expect(JSON.stringify(j)).not.toContain("비밀상호가든");
  });
});

// ════════════════════════════════════════════════════════════════════════
// 인증/권한/정지 (통과 기대)
// ════════════════════════════════════════════════════════════════════════
describe("인증·정지 게이트 — 세션 라우트도 봉인", () => {
  it("S10 무인증·위조서명은 401, 세션은 부수효과 0", async () => {
    const s = await seedOne("s10");
    const sess = await startSession({ tenantId: s.tenantId, operatorId: s.operatorId, customerId: s.customerId, remoteId: "323608526" });

    // 무인증 end
    let res = await endRoute(authPostRaw(`http://t/api/sessions/${sess.id}/end`, null, "{}"), ctxOf(sess.id));
    expect(res.status).toBe(401);
    // 무인증 discard
    res = await discardRoute(authPostRaw(`http://t/api/sessions/${sess.id}/discard`, null, "{}"), ctxOf(sess.id));
    expect(res.status).toBe(401);

    // 위조서명(구조는 올바르나 다른 비밀로 서명한 JWT) end
    const forged = await new SignJWT({
      uid: s.operatorId, email: "op@x", displayName: "재성", role: "operator", tenantId: s.tenantId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("chainremote-admin")
      .setAudience("chainremote-desktop")
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(new TextEncoder().encode("WRONG-SECRET-attacker"));
    res = await endRoute(authPost(`http://t/api/sessions/${sess.id}/end`, forged, { resolution: "resolved" }), ctxOf(sess.id));
    expect(res.status).toBe(401);
    res = await discardRoute(authPost(`http://t/api/sessions/${sess.id}/discard`, forged), ctxOf(sess.id));
    expect(res.status).toBe(401);

    // 세션은 그대로 — endedAt null, 존재.
    const r = await row(sess.id);
    expect(r).toBeDefined();
    expect(r.endedAt).toBeNull();
  });

  it("S11 정지(suspended) 테넌트 토큰은 전 세션 라우트에서 401", async () => {
    const T = await mkTenant("s11", { subscriptionStatus: "suspended" });
    const op = await mkUser(T, "op@x", "재성", "operator");
    const cust = await mkCustomer(T, "가든", "323608526");
    const tok = await bearer(op, T, "operator");

    expect((await startRoute(authPost("http://t/api/sessions", tok, { remoteId: "323608526" }))).status).toBe(401);
    expect((await endRoute(authPost(`http://t/api/sessions/${RANDOM_UUID}/end`, tok, {}), ctxOf(RANDOM_UUID))).status).toBe(401);
    expect((await discardRoute(authPost(`http://t/api/sessions/${RANDOM_UUID}/discard`, tok), ctxOf(RANDOM_UUID))).status).toBe(401);
    expect((await custSessRoute(authGet(`http://t/api/customers/${cust}/sessions`, tok), ctxOf(cust))).status).toBe(401);
    expect((await recentRoute(authGet("http://t/api/sessions/recent", tok))).status).toBe(401);
  });

  it("S11b is_active=false 테넌트도 POST /api/sessions 401", async () => {
    const T = await mkTenant("s11b", { isActive: false });
    const op = await mkUser(T, "op@x", "재성", "operator");
    await mkCustomer(T, "가든", "323608526");
    const tok = await bearer(op, T, "operator");
    expect((await startRoute(authPost("http://t/api/sessions", tok, { remoteId: "323608526" }))).status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 아이덴포턴시 / 입력검증 / 다운그레이드 (통과 기대)
// ════════════════════════════════════════════════════════════════════════
describe("start 아이덴포턴시 & end 화이트리스트 & remoteId 입력", () => {
  it("S6 재접속은 활성세션 재사용(같은 id, 활성 1행), 종료된 세션은 재사용 금지", async () => {
    const s = await seedOne("s6");
    const tok = await bearer(s.operatorId, s.tenantId);

    // (a) 연속 2회 → 같은 sessionId, 활성 정확히 1행.
    const j1 = await (await startRoute(authPost("http://t/api/sessions", tok, { remoteId: "323608526" }))).json();
    const j2 = await (await startRoute(authPost("http://t/api/sessions", tok, { remoteId: "323608526" }))).json();
    expect(typeof j1.sessionId).toBe("string");
    expect(j2.sessionId).toBe(j1.sessionId);
    expect(await activeCount(s.operatorId, s.customerId)).toBe(1);

    // (b) 종료 후 재시작 → 새 sessionId (종료 세션이 되살아나면 안 됨).
    await endSession(j1.sessionId, s.tenantId);
    const j3 = await (await startRoute(authPost("http://t/api/sessions", tok, { remoteId: "323608526" }))).json();
    expect(j3.sessionId).not.toBe(j1.sessionId);
  });

  it("S8a 화이트리스트 밖 resolution 은 무시(문자/숫자), 유효값은 저장", async () => {
    const s = await seedOne("s8a");
    const tok = await bearer(s.operatorId, s.tenantId);
    const sess = await startSession({ tenantId: s.tenantId, operatorId: s.operatorId, customerId: s.customerId, remoteId: "323608526" });

    await endRoute(authPost(`http://t/api/sessions/${sess.id}/end`, tok, { resolution: "hacked" }), ctxOf(sess.id));
    expect((await row(sess.id)).resolution).toBe("in_progress"); // 임의 문자열은 enum 에 안 들어감.

    await endRoute(authPost(`http://t/api/sessions/${sess.id}/end`, tok, { resolution: 123 }), ctxOf(sess.id));
    expect((await row(sess.id)).resolution).toBe("in_progress"); // 비문자도 무시.

    await endRoute(authPost(`http://t/api/sessions/${sess.id}/end`, tok, { resolution: "resolved" }), ctxOf(sess.id));
    expect((await row(sess.id)).resolution).toBe("resolved"); // 유효값은 반영.
  });

  it("S7-inject SQL 특수문자는 리터럴로 저장되고 테이블은 생존(주입 안 됨)", async () => {
    const s = await seedOne("s7i");
    const tok = await bearer(s.operatorId, s.tenantId);
    const sess = await startSession({ tenantId: s.tenantId, operatorId: s.operatorId, customerId: s.customerId, remoteId: "323608526" });
    const evil = "'; DROP TABLE support_sessions;--";
    const res = await endRoute(authPost(`http://t/api/sessions/${sess.id}/end`, tok, { description: evil }), ctxOf(sess.id));
    expect(res.status).toBe(200);
    expect((await row(sess.id)).description).toBe(evil); // 파라미터 바인딩 → 리터럴.
    expect(await totalSessions()).toBeGreaterThanOrEqual(1); // 테이블 살아있음.
  });

  it("S14 remoteId 악성/기형 입력: 누락·공백·숫자는 400, 앞뒤공백 패딩은 trim 후 매칭", async () => {
    const s = await seedOne("s14");
    const tok = await bearer(s.operatorId, s.tenantId);

    // (a) body {} — remoteId 누락
    const rA = await startRoute(authPost("http://t/api/sessions", tok, {}));
    expect(rA.status).toBe(400);
    // (b) 공백만
    const rB = await startRoute(authPost("http://t/api/sessions", tok, { remoteId: "   " }));
    expect(rB.status).toBe(400);
    // (c) 숫자 타입 (typeof !== string → 조용히 무시 → 400)
    const rC = await startRoute(authPost("http://t/api/sessions", tok, { remoteId: 445497547 }));
    expect(rC.status).toBe(400);
    // (d) 앞뒤공백 패딩된 실 거래처 ID → trim 후 매칭 → 201
    const rD = await startRoute(authPost("http://t/api/sessions", tok, { remoteId: " 323608526 " }));
    expect(rD.status).toBe(201);
    expect(typeof (await rD.json()).sessionId).toBe("string");
  });
});

// ════════════════════════════════════════════════════════════════════════
// 현동작 문서화 — 설계상 위험(통과하되 리스크로 보고)
// ════════════════════════════════════════════════════════════════════════
describe("현동작 문서화 (데이터정합 위험 플래그)", () => {
  it("S8b resolution 다운그레이드가 실제로 일어남 — 완료 세션이 재오픈됨(현동작)", async () => {
    const s = await seedOne("s8b");
    const tok = await bearer(s.operatorId, s.tenantId);
    const sess = await startSession({ tenantId: s.tenantId, operatorId: s.operatorId, customerId: s.customerId, remoteId: "323608526" });

    await endRoute(authPost(`http://t/api/sessions/${sess.id}/end`, tok, { resolution: "resolved", description: "완료" }), ctxOf(sess.id));
    expect((await row(sess.id)).resolution).toBe("resolved");

    // 두 번째 end 로 in_progress 되돌림 — endSession 은 값이 오면 무조건 덮는다.
    await endRoute(authPost(`http://t/api/sessions/${sess.id}/end`, tok, { resolution: "in_progress" }), ctxOf(sess.id));
    expect((await row(sess.id)).resolution).toBe("in_progress"); // 다운그레이드 발생(위험: 완료 이력 재오픈).
  });

  it("S9 discard 는 완결·장시간 세션도 가드 없이 영구삭제(데이터손실 위험)", async () => {
    const s = await seedOne("s9");
    const tok = await bearer(s.operatorId, s.tenantId);
    const sess = await startSession({ tenantId: s.tenantId, operatorId: s.operatorId, customerId: s.customerId, remoteId: "323608526" });

    // started_at 을 1시간 전으로 밀어 "완결 장시간" 이력을 만든다.
    await testDb()
      .update(supportSessions)
      .set({ startedAt: new Date(Date.now() - 3600_000) })
      .where(eq(supportSessions.id, sess.id));
    await endSession(sess.id, s.tenantId, { description: "1시간 원격 완료", contactName: "김점장", resolution: "resolved" });

    const before = await row(sess.id);
    expect(before.durationSec!).toBeGreaterThanOrEqual(3000); // ~3600s 완결 이력.
    expect(before.description).toContain("완료");

    // 서버는 duration·ended 상태를 전혀 안 보고 무조건 DELETE — 완결 이력이 소프트삭제 없이 소실.
    const res = await discardRoute(authPost(`http://t/api/sessions/${sess.id}/discard`, tok), ctxOf(sess.id));
    expect(res.status).toBe(200);
    expect(await row(sess.id)).toBeUndefined(); // 무가드 영구삭제 실증.
  });

  it("S13 삭제 거래처 orphan 세션: 전체 타임라인엔 잔존(customer null), 거래처별/remoteId 조회엔 소실", async () => {
    const s = await seedOne("s13");
    const sess = await startSession({ tenantId: s.tenantId, operatorId: s.operatorId, customerId: s.customerId, remoteId: "323608526" });
    await endSession(sess.id, s.tenantId, { description: "점검" });

    // 거래처 삭제 → FK ON DELETE SET NULL 로 세션 customerId=null.
    await testDb().delete(customers).where(eq(customers.id, s.customerId));

    // (a) 전체 타임라인엔 남는다(이력 보존).
    const all = await listRecentSessions(s.tenantId);
    expect(all.length).toBe(1);
    expect(all[0].customer).toBeNull();

    // (b) per-거래처 조회는 이제 빈 결과 — 지원이력이 거래처 관점에서 사라짐.
    expect((await listCustomerSessions(s.customerId, s.tenantId)).length).toBe(0);

    // (c) 옛 remoteId 필터도 customers 조인이 끊겨 빈 결과.
    expect((await listRecentSessions(s.tenantId, 100, "323608526")).length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// ★ 결함 후보 — 의도≠실제. 실패 상태로 남긴다(억지 통과 금지).
// ════════════════════════════════════════════════════════════════════════
describe("[결함 후보] 입력검증 공백 & 경합 (실패로 남김)", () => {
  it("S5-end 비UUID path id 는 400/404 여야 하고 SQL 이 새면 안 됨 (현재 500+쿼리누출)", async () => {
    const s = await seedOne("s5e");
    const tok = await bearer(s.operatorId, s.tenantId);
    const res = await endRoute(authPostRaw("http://t/api/sessions/not-a-uuid/end", tok, "{}"), ctxOf("not-a-uuid"));
    const body = await res.text();
    expect([400, 404]).toContain(res.status);
    expect(body).not.toMatch(/Failed query|support_sessions|params:/);
  });

  it("S5-discard 비UUID path id 는 400/404 여야 함 (현재 500+쿼리누출)", async () => {
    const s = await seedOne("s5d");
    const tok = await bearer(s.operatorId, s.tenantId);
    const res = await discardRoute(authPostRaw("http://t/api/sessions/abc/discard", tok, "{}"), ctxOf("abc"));
    const body = await res.text();
    expect([400, 404]).toContain(res.status);
    expect(body).not.toMatch(/Failed query|support_sessions|params:/);
  });

  it("S5-custSessions 비UUID(SQL 특수문자) path id 는 400/404 여야 함 (현재 500+쿼리누출)", async () => {
    const s = await seedOne("s5c");
    const tok = await bearer(s.operatorId, s.tenantId);
    const res = await custSessRoute(authGet("http://t/api/customers/x/sessions", tok), ctxOf("'; DROP--"));
    const body = await res.text();
    expect([400, 404]).toContain(res.status);
    expect(body).not.toMatch(/Failed query|support_sessions|params:/);
  });

  it("S7 NUL바이트 필드는 정제/거부(≠500) 되어야 함 (현재 500+쿼리누출)", async () => {
    const s = await seedOne("s7");
    const tok = await bearer(s.operatorId, s.tenantId);
    const sess = await startSession({ tenantId: s.tenantId, operatorId: s.operatorId, customerId: s.customerId, remoteId: "323608526" });
    const rawBody = JSON.stringify({ description: "bad" + NUL + "nul", categories: "a" + NUL + "b", contactName: NUL });
    const res = await endRoute(authPostRaw(`http://t/api/sessions/${sess.id}/end`, tok, rawBody), ctxOf(sess.id));
    const body = await res.text();
    expect(res.status).not.toBe(500);
    expect(body).not.toMatch(/Failed query|params:/);
  });

  it("S12 동시 start TOCTOU — operator+customer 당 활성 1세션이어야 함 (현재 2행 중복)", async () => {
    const s = await seedOne("s12");
    const input = { tenantId: s.tenantId, operatorId: s.operatorId, customerId: s.customerId, remoteId: "323608526" };
    await Promise.all([startSession(input), startSession(input)]);
    // 정책: 같은 직원·거래처는 활성 1세션(재사용 전제). select-then-insert 경합 + DB 유니크 부재 → 2행.
    expect(await activeCount(s.operatorId, s.customerId)).toBe(1);
  });
});
