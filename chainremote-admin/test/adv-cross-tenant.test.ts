// 적대적 재검증 — 1.4.56~65 신규 라우트/데이터레이어의 멀티테넌트 격리.
//
// 노림수: remote_id 는 전역 unique(마이그011)라 "남의 기기"를 정확히 지목할 수 있다.
//   그 상태에서 tenant A 토큰/호출로 tenant B 의 기기에 ① 파괴적 명령(디스크 정리)
//   큐잉 ② 알림 기반 기기 탈취 ③ 세션 삭제/위조/종료 ④ 지원이력 정탐 이 되는지 두들긴다.
//   기대: 전부 tenantId 필터에 막혀 "허위 성공(ok:true)이라도 실제 부작용은 0" 이어야 한다.
//
// 소스는 절대 수정하지 않는다 — 테스트만. 의도≠실제로 벌어지는 것만 "결함 후보" 로 분리.

import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  tenants,
  users,
  customers,
  supportSessions,
  customerAlerts,
  userFavorites,
} from "@/lib/schema";
import { signApiToken } from "@/lib/api-auth";
import {
  applyAlertMoveToNew,
  applyAlertRename,
  resolveAlert,
} from "@/lib/data/alerts";
import { startSession } from "@/lib/data/sessions";
import { POST as cleanupPOST } from "@/app/api/customers/cleanup/route";
import { POST as sessionsPOST } from "@/app/api/sessions/route";
import { POST as discardPOST } from "@/app/api/sessions/[id]/discard/route";
import { POST as endPOST } from "@/app/api/sessions/[id]/end/route";
import { GET as customerSessionsGET } from "@/app/api/customers/[id]/sessions/route";
import { GET as recentGET } from "@/app/api/sessions/recent/route";

// ── 시드 헬퍼 (기존 테스트 패턴 그대로) ──
type Role = "owner" | "admin" | "operator" | "viewer" | "super_admin";
interface TenantOpts {
  isActive?: boolean;
  subscriptionStatus?: "active" | "suspended" | "cancelled";
}

async function makeTenant(slug: string, opts: TenantOpts = {}): Promise<string> {
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

async function makeUser(
  tenantId: string,
  email: string,
  role: Role = "owner",
): Promise<string> {
  const db = testDb();
  const [u] = await db
    .insert(users)
    .values({ tenantId, email, passwordHash: "x", displayName: email, role })
    .returning({ id: users.id });
  return u.id;
}

async function makeCustomer(
  tenantId: string,
  name: string,
  remoteId: string | null,
  extra: { heartbeatToken?: string | null; isInternal?: boolean } = {},
): Promise<string> {
  const db = testDb();
  const [c] = await db
    .insert(customers)
    .values({
      tenantId,
      name,
      remoteId,
      heartbeatToken: extra.heartbeatToken ?? null,
      isInternal: extra.isInternal ?? false,
    })
    .returning({ id: customers.id });
  return c.id;
}

async function makeAlert(
  tenantId: string,
  customerId: string,
  type: string,
  detail: Record<string, unknown>,
): Promise<string> {
  const db = testDb();
  const [a] = await db
    .insert(customerAlerts)
    .values({ tenantId, customerId, type, detail: JSON.stringify(detail) })
    .returning({ id: customerAlerts.id });
  return a.id;
}

async function token(
  uid: string,
  tenantId: string,
  role: Role = "owner",
): Promise<string> {
  const { token } = await signApiToken({
    uid,
    email: `${uid}@x`,
    displayName: uid,
    role,
    tenantId,
  });
  return token;
}

function bearer(t: string): HeadersInit {
  return { authorization: `Bearer ${t}`, "content-type": "application/json" };
}

async function customerRow(id: string) {
  const db = testDb();
  const [r] = await db.select().from(customers).where(eq(customers.id, id));
  return r;
}

async function sessionRow(id: string) {
  const db = testDb();
  const [r] = await db
    .select()
    .from(supportSessions)
    .where(eq(supportSessions.id, id));
  return r;
}

async function jsonOf(res: Response) {
  return { status: res.status, json: await res.json() };
}

// ── 라우트 호출 래퍼 ──
async function callCleanup(t: string, remoteId: string) {
  const req = new Request("http://t/api/customers/cleanup", {
    method: "POST",
    headers: bearer(t),
    body: JSON.stringify({ remoteId }),
  });
  return jsonOf(await cleanupPOST(req));
}
async function callStartSession(t: string, remoteId: string) {
  const req = new Request("http://t/api/sessions", {
    method: "POST",
    headers: bearer(t),
    body: JSON.stringify({ remoteId }),
  });
  return jsonOf(await sessionsPOST(req));
}
async function callDiscard(t: string, id: string) {
  const req = new Request(`http://t/api/sessions/${encodeURIComponent(id)}/discard`, {
    method: "POST",
    headers: bearer(t),
  });
  return jsonOf(await discardPOST(req, { params: Promise.resolve({ id }) }));
}
async function callEnd(t: string, id: string, body: Record<string, unknown>) {
  const req = new Request(`http://t/api/sessions/${encodeURIComponent(id)}/end`, {
    method: "POST",
    headers: bearer(t),
    body: JSON.stringify(body),
  });
  return jsonOf(await endPOST(req, { params: Promise.resolve({ id }) }));
}
async function callCustomerSessions(t: string, id: string) {
  const req = new Request(
    `http://t/api/customers/${encodeURIComponent(id)}/sessions`,
    { method: "GET", headers: bearer(t) },
  );
  return jsonOf(await customerSessionsGET(req, { params: Promise.resolve({ id }) }));
}
async function callRecent(t: string, remoteId?: string) {
  const url = remoteId
    ? `http://t/api/sessions/recent?remoteId=${encodeURIComponent(remoteId)}`
    : "http://t/api/sessions/recent";
  const req = new Request(url, { method: "GET", headers: bearer(t) });
  return jsonOf(await recentGET(req));
}

// 두 회사 A/B 를 심고 B 에 원격기기(remote_id, 토큰) 한 대를 둔다.
async function seedAB() {
  const tA = await makeTenant("adv-a");
  const tB = await makeTenant("adv-b");
  const uA = await makeUser(tA, "changA");
  const uB = await makeUser(tB, "jaesungB");
  const cB = await makeCustomer(tB, "B마트", "GN20000002", {
    heartbeatToken: "B-secret-token-hash",
  });
  return { tA, tB, uA, uB, cB };
}

// ══════════════════════════════════════════════════════════════════════════
describe("XT: cross-tenant 격리 — 파괴/세션/알림 (격리가 지켜져야 통과)", () => {
  // XT-01 ────────────────────────────────────────────────────────────────
  it("XT-01 타 tenant 기기에 디스크 정리(영구삭제) 명령을 못 큐한다 (404 + 부작용 0)", async () => {
    const { tA, uA, cB } = await seedAB();
    const r = await callCleanup(await token(uA, tA, "owner"), "GN20000002");
    expect(r.status).toBe(404);
    expect(r.json.error).toContain("거래처");
    // ★핵심: B POS 에 영구삭제 명령이 큐되지 않았다.
    expect((await customerRow(cB)).cleanupRequestedAt).toBeNull();
  });

  // XT-02 ────────────────────────────────────────────────────────────────
  it("XT-02 타 tenant 알림으로 기기 탈취 불가 (applyAlertMoveToNew cross-tenant)", async () => {
    const db = testDb();
    const { tA, tB, uB, cB } = await seedAB();
    // B 즐겨찾기 + B 알림(reinstalled_new_name) 시드.
    await db
      .insert(userFavorites)
      .values({ userId: uB, remoteId: "GN20000002", customerId: cB, tenantId: tB });
    const alertId = await makeAlert(tB, cB, "reinstalled_new_name", {
      remoteId: "GN20000002",
      newName: "탈취상호",
    });

    const ok = await applyAlertMoveToNew(alertId, tA); // A 가 B 알림을 처리 시도
    expect(ok).toBe(false);

    // 부작용 전무 확인.
    const c = await customerRow(cB);
    expect(c.remoteId).toBe("GN20000002"); // 기기 안 떨어짐
    expect(c.heartbeatToken).toBe("B-secret-token-hash"); // 토큰 승계(탈취) 안 됨
    // 신규 customer 미생성.
    const all = await db.select().from(customers);
    expect(all.length).toBe(1);
    // device_moved 감사알림 미생성 / 원래 알림 미해결.
    const alerts = await db.select().from(customerAlerts);
    expect(alerts.length).toBe(1);
    expect(alerts[0].type).toBe("reinstalled_new_name");
    expect(alerts[0].resolvedAt).toBeNull();
    // B 즐겨찾기 소속 거래처 미변경.
    const [fav] = await db
      .select()
      .from(userFavorites)
      .where(eq(userFavorites.userId, uB));
    expect(fav.customerId).toBe(cB);
  });

  // XT-03 ────────────────────────────────────────────────────────────────
  it("XT-03 타 tenant 세션을 discard 로 못 지운다 (허위 ok:true, 실제 삭제 0)", async () => {
    const { tA, tB, uB, cB, uA } = await seedAB();
    const s = await startSession({
      tenantId: tB,
      operatorId: uB,
      customerId: cB,
      remoteId: "GN20000002",
    });
    const r = await callDiscard(await token(uA, tA, "owner"), s.id);
    expect(r.json.ok).toBe(true); // 라우트는 매칭수 무관 허위 성공
    // ★그러나 B 세션은 DB 에 그대로 생존.
    expect(await sessionRow(s.id)).not.toBeUndefined();
  });

  // XT-04 ────────────────────────────────────────────────────────────────
  it("XT-04 전역 unique remote_id 로 타 tenant 세션 위조 불가 (skipped:unknown)", async () => {
    const db = testDb();
    const { tA, uA } = await seedAB();
    const r = await callStartSession(await token(uA, tA, "operator"), "GN20000002");
    expect(r.json.sessionId).toBeNull();
    expect(r.json.skipped).toBe("unknown"); // A 스코프엔 그 remote_id 가 미등록
    // ★support_sessions 에 어떤 행도 안 생겼다(presence 위조 차단).
    const sess = await db.select().from(supportSessions);
    expect(sess.length).toBe(0);
  });

  // XT-05 ────────────────────────────────────────────────────────────────
  it("XT-05 타 tenant 거래처 UUID 로 지원이력 열람 불가 (200 빈배열, 내용 무유출)", async () => {
    const { tA, tB, uA, uB, cB } = await seedAB();
    const s = await startSession({
      tenantId: tB,
      operatorId: uB,
      customerId: cB,
      remoteId: "GN20000002",
    });
    const db = testDb();
    await db
      .update(supportSessions)
      .set({ description: "B의 비밀 내용", contactName: "B점장" })
      .where(eq(supportSessions.id, s.id));

    const r = await callCustomerSessions(await token(uA, tA, "owner"), cB);
    expect(r.status).toBe(200);
    expect(r.json.sessions).toEqual([]); // UUID 를 알아도 tenant 필터가 막는다
  });

  // XT-06 ────────────────────────────────────────────────────────────────
  it("XT-06 recent?remoteId 로 타 tenant 활동 정탐 불가 (200 빈배열)", async () => {
    const { tA, tB, uA, uB, cB } = await seedAB();
    await startSession({
      tenantId: tB,
      operatorId: uB,
      customerId: cB,
      remoteId: "GN20000002",
    });
    const r = await callRecent(await token(uA, tA, "owner"), "GN20000002");
    expect(r.status).toBe(200);
    expect(r.json.sessions).toEqual([]); // 남의 remote_id 로 타임라인 못 캔다
  });

  // XT-08 ────────────────────────────────────────────────────────────────
  it("XT-08 타 tenant 알림 무시/개명 불가 + 올바른 tenant 로는 정상 (격리 과하지 않음)", async () => {
    const db = testDb();
    const { tA, tB } = await seedAB();
    const cRename = await makeCustomer(tB, "옛간판", "GN20000010");
    const renameId = await makeAlert(tB, cRename, "reinstalled_new_name", {
      remoteId: "GN20000010",
      newName: "새간판",
    });
    const cResolve = await makeCustomer(tB, "무시대상", "GN20000011");
    const resolveId = await makeAlert(tB, cResolve, "reinstalled_new_name", {
      remoteId: "GN20000011",
      newName: "x",
    });

    // A 가 B 알림을 처리 시도 → 전부 false, 무변경.
    expect(await applyAlertRename(renameId, tA)).toBe(false);
    expect(await resolveAlert(resolveId, tA)).toBe(false);
    expect((await customerRow(cRename)).name).toBe("옛간판");
    const [openResolve] = await db
      .select()
      .from(customerAlerts)
      .where(eq(customerAlerts.id, resolveId));
    expect(openResolve.resolvedAt).toBeNull();

    // 올바른 소유 tenant(B)로는 정상 동작 — 격리가 과하지 않음을 대조.
    expect(await applyAlertRename(renameId, tB)).toBe(true);
    expect((await customerRow(cRename)).name).toBe("새간판");
    expect(await resolveAlert(resolveId, tB)).toBe(true);
  });

  // XT-10 ────────────────────────────────────────────────────────────────
  it("XT-10 applyAlertMoveToNew 이중 적용(재전송) 멱등 — 새 거래처는 정확히 1개", async () => {
    const db = testDb();
    const tA = await makeTenant("adv-idem");
    const cA = await makeCustomer(tA, "옛매장", "RID1234567", {
      heartbeatToken: "tok-A",
    });
    const alertId = await makeAlert(tA, cA, "reinstalled_new_name", {
      remoteId: "RID1234567",
      newName: "새매장",
    });

    expect(await applyAlertMoveToNew(alertId, tA)).toBe(true); // 1회차
    expect(await applyAlertMoveToNew(alertId, tA)).toBe(false); // 2회차(이미 해결)

    // 새 거래처는 정확히 1개(중복 이관/토큰 이중승계 없음).
    const dst = await db
      .select()
      .from(customers)
      .where(eq(customers.name, "새매장"));
    expect(dst.length).toBe(1);
    expect(dst[0].remoteId).toBe("RID1234567");
    expect(dst[0].heartbeatToken).toBe("tok-A"); // 승계 1회
    // remote_id 를 든 행도 정확히 1개(전역 unique 유지) — 옛 행은 null 화됨.
    const holders = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, "RID1234567"));
    expect(holders.length).toBe(1);
    expect((await customerRow(cA)).remoteId).toBeNull();
  });

  // XT-11 ────────────────────────────────────────────────────────────────
  it("XT-11 super_admin 은 정지검사만 우회, 리소스는 여전히 자기 tenant 로 스코프", async () => {
    const { tB, uB, cB } = await seedAB();
    // super_admin 이지만 tenantId 는 A(다른 회사). B 리소스엔 못 닿아야 한다.
    const tA = await makeTenant("adv-super");
    const uSuper = await makeUser(tA, "hq", "super_admin");
    const tok = await token(uSuper, tA, "super_admin");

    await startSession({
      tenantId: tB,
      operatorId: uB,
      customerId: cB,
      remoteId: "GN20000002",
    });

    const hist = await callCustomerSessions(tok, cB); // B 거래처 UUID
    expect(hist.status).toBe(200);
    expect(hist.json.sessions).toEqual([]); // super_admin 도 B 이력 못 봄

    const clean = await callCleanup(tok, "GN20000002"); // B 기기 remote_id
    expect(clean.status).toBe(404); // super_admin 도 B 파괴 불가
    expect((await customerRow(cB)).cleanupRequestedAt).toBeNull();
  });

  // XT-12 ────────────────────────────────────────────────────────────────
  it("XT-12 end 라우트 cross-tenant + body-tenant 위조 무력 (허위 ok, 실제 변경 0)", async () => {
    const { tA, tB, uA, uB, cB } = await seedAB();
    const s = await startSession({
      tenantId: tB,
      operatorId: uB,
      customerId: cB,
      remoteId: "GN20000002",
    });
    const r = await callEnd(await token(uA, tA, "owner"), s.id, {
      resolution: "resolved",
      tenantId: tB, // body 에 남의 tenantId 주입 시도
      description: "조작",
    });
    expect(r.json.ok).toBe(true); // 허위 성공
    // ★B 세션은 안 끝났고 내용도 안 바뀜(body.tenantId 무시, me.tenantId=A 스코프).
    const row = await sessionRow(s.id);
    expect(row.endedAt).toBeNull();
    expect(row.description).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("XT-07: 정지/해지 tenant 토큰은 신규 파괴/세션 라우트에서도 차단", () => {
  it("suspended tenant 의 유효 토큰으로 cleanup/sessions/history 전부 401", async () => {
    const db = testDb();
    const tA = await makeTenant("adv-susp", { subscriptionStatus: "suspended" });
    const uA = await makeUser(tA, "susp-owner");
    const cA = await makeCustomer(tA, "정지전거래처", "SP10000001");
    const tok = await token(uA, tA, "owner"); // 정지 전 발급분 모사(서명만 유효)

    const clean = await callCleanup(tok, "SP10000001");
    expect(clean.status).toBe(401);
    expect((await customerRow(cA)).cleanupRequestedAt).toBeNull(); // 파괴 안 큐됨

    const start = await callStartSession(tok, "SP10000001");
    expect(start.status).toBe(401);

    const hist = await callCustomerSessions(tok, cA);
    expect(hist.status).toBe(401);
  });

  it("cancelled tenant 도 동일하게 401", async () => {
    const tA = await makeTenant("adv-cancel", { subscriptionStatus: "cancelled" });
    const uA = await makeUser(tA, "cancel-owner");
    await makeCustomer(tA, "가게", "SP10000002");
    const clean = await callCleanup(await token(uA, tA, "owner"), "SP10000002");
    expect(clean.status).toBe(401);
  });

  it("super_admin 은 정지 tenant 여도 자기 거래처엔 접근(자기잠금 방지 — 대조)", async () => {
    const tA = await makeTenant("adv-susp-super", {
      subscriptionStatus: "suspended",
    });
    const uS = await makeUser(tA, "hq2", "super_admin");
    await makeCustomer(tA, "본사관리대상", "SP10000003");
    const r = await callCleanup(await token(uS, tA, "super_admin"), "SP10000003");
    expect(r.status).toBe(200); // 정지검사 예외 → 자기 tenant 리소스는 동작
    expect(r.json.ok).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 권한·견고성 — 현행 동작 관찰(통과) + 의도≠실제 결함 후보(실패로 노출).
// 여기의 실패 케이스는 소스 수정 없이 "후보"로만 남긴다(Chang 승인 후 별도 수정).
describe("XT-09/XT-13: 권한·견고성 — 현행 동작 관찰(통과)", () => {
  // XT-09 현행: cleanup 라우트는 requireApiAuth 만 — role 게이트 없음.
  it("XT-09 operator 는 정리 큐잉 허용(200), viewer 는 차단(403) — 정책 게이트", async () => {
    const tA = await makeTenant("adv-role");
    const cA = await makeCustomer(tA, "우리매장", "RL10000001");
    const op = await makeUser(tA, "op1", "operator");
    const vw = await makeUser(tA, "vw1", "viewer");

    // operator 는 원격지원 일부로 정리 허용(정책 2026-07-21: owner+operator).
    const rOp = await callCleanup(await token(op, tA, "operator"), "RL10000001");
    expect(rOp.status).toBe(200);
    expect(rOp.json.ok).toBe(true);
    expect((await customerRow(cA)).cleanupRequestedAt).not.toBeNull(); // 실제 큐됨

    // viewer(읽기 전용)는 파괴적(영구삭제) 정리 차단(403).
    const db = testDb();
    await db
      .update(customers)
      .set({ cleanupRequestedAt: null })
      .where(eq(customers.id, cA));
    const rVw = await callCleanup(await token(vw, tA, "viewer"), "RL10000001");
    expect(rVw.status).toBe(403);
  });

  // XT-13 현행: 경로 파라미터가 파라미터화되어 SQL 인젝션은 안 된다(테이블 생존).
  it("XT-13 SQL 특수문자 경로 파라미터는 인젝션되지 않는다(테이블·데이터 생존)", async () => {
    const tA = await makeTenant("adv-inj");
    const uA = await makeUser(tA, "inj-owner");
    const cA = await makeCustomer(tA, "가게", "IJ10000001");
    const s = await startSession({
      tenantId: tA,
      operatorId: uA,
      customerId: cA,
      remoteId: "IJ10000001",
    });
    const tok = await token(uA, tA, "owner");
    // DROP 시도가 담긴 id — drizzle 바인딩이라 실행 안 됨(500 이든 아니든 무해).
    await callDiscard(tok, "'; DROP TABLE support_sessions; --").catch(() => {});
    // ★테이블·행이 그대로 살아있다 = 인젝션 차단.
    expect(await sessionRow(s.id)).not.toBeUndefined();
    const db = testDb();
    const all = await db.select().from(supportSessions);
    expect(all.length).toBe(1);
  });
});

describe("XT-09/XT-13: 결함 후보 (의도≠실제) — 소스 수정 금지, 실패로 노출", () => {
  // XT-09: 정책 확정(2026-07-21) — cleanup 은 owner+operator 허용, viewer 만 차단.
  //   operator 는 원격지원 업무의 일부로 정리를 낼 수 있다(형제 라우트인 거래처 수정/삭제는
  //   여전히 owner 전용이지만, 유지보수성 정리는 operator 까지 허용이 팀 결정).
  it("XT-09 operator 는 정리 큐잉 허용(200) — 원격지원 일부(정책)", async () => {
    const tA = await makeTenant("adv-role-bug");
    await makeCustomer(tA, "우리매장", "RL20000001");
    const op = await makeUser(tA, "op2", "operator");
    const r = await callCleanup(await token(op, tA, "operator"), "RL20000001");
    expect(r.status).toBe(200);
  });

  // XT-13 결함후보: 기형 비-UUID 경로 파라미터가 uuid 컬럼 비교에서 throw → 500.
  //   인증된 사용자라 심각도는 낮지만, 이상적으로는 404/빈결과여야 한다(견고성).
  it("XT-13 기형 UUID 경로는 500 대신 404/빈결과여야 한다(GET customers/[id]/sessions)", async () => {
    const tA = await makeTenant("adv-mal");
    const uA = await makeUser(tA, "mal-owner");
    const r = await callCustomerSessions(await token(uA, tA, "owner"), "not-a-uuid");
    // 기대(의도): 깔끔한 404 또는 200 빈배열. 현행 실제: 500(uuid invalid syntax) → 실패로 노출.
    expect(r.status).not.toBe(500);
  });
});
