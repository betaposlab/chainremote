import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  startSession,
  endSession,
  discardSession,
  listCustomerSessions,
  listRecentSessions,
} from "@/lib/data/sessions";
import { activeLoginSessions, tenants, users, customers, supportSessions } from "@/lib/schema";
import { signApiToken } from "@/lib/api-auth";
import { POST as startSessionRoute } from "@/app/api/sessions/route";

// HQ 지원세션 기록 — 종료 시 duration 자동계산 + 선택필드(응대자·종류·내용·처리결과) 저장,
//   전부 선택적(안 적으면 빈 채로), per-거래처/전체 조회. Phase 1 백엔드 계약을 못박는다.

async function seed() {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug: "hqsess", displayName: "hqsess" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({
      tenantId: t.id,
      email: "op1",
      displayName: "재성",
      passwordHash: "x",
      role: "operator",
    })
    .returning({ id: users.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name: "도덕봉가든", remoteId: "323608526" })
    .returning({ id: customers.id });
  return { tenantId: t.id, operatorId: u.id, customerId: c.id };
}

async function row(id: string) {
  const db = testDb();
  const [r] = await db
    .select()
    .from(supportSessions)
    .where(eq(supportSessions.id, id))
    .limit(1);
  return r;
}

describe("HQ 지원세션 기록 (Phase 1)", () => {
  it("종료 시 선택필드 저장 + duration 계산", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "323608526",
    });
    await endSession(sess.id, s.tenantId, {
      categories: "printer,payment",
      description: "영수증 프린터 재설정 + 카드단말 재연결",
      contactName: "김점장",
      resolution: "resolved",
    });
    const r = await row(sess.id);
    expect(r.endedAt).not.toBeNull();
    expect(r.durationSec).not.toBeNull();
    expect(r.durationSec! >= 0).toBe(true);
    expect(r.categories).toBe("printer,payment");
    expect(r.description).toContain("프린터");
    expect(r.contactName).toBe("김점장");
    expect(r.resolution).toBe("resolved");
  });

  it("★필드 전부 생략(스킵)해도 종료·duration 은 남고 나머지는 null", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "323608526",
    });
    await endSession(sess.id, s.tenantId); // 아무 필드 없이
    const r = await row(sess.id);
    expect(r.endedAt).not.toBeNull();
    expect(r.durationSec).not.toBeNull();
    expect(r.categories).toBeNull();
    expect(r.contactName).toBeNull();
  });

  it("보강 저장(두 번째 end)은 첫 종료시각을 보존한다 — 원격시간 안 부풂", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "323608526",
    });
    // HQ 흐름: 끊자마자 시간만 기록 → 메인 창 모달에서 나중에 내용 보강.
    await endSession(sess.id, s.tenantId);
    const first = await row(sess.id);
    await new Promise((r) => setTimeout(r, 20)); // now() 가 실제로 달라지게
    await endSession(sess.id, s.tenantId, {
      categories: "printer",
      description: "보강",
      resolution: "resolved",
    });
    const second = await row(sess.id);
    expect(second.endedAt!.getTime()).toBe(first.endedAt!.getTime());
    expect(second.categories).toBe("printer");
    expect(second.description).toBe("보강");
  });

  it("per-거래처 + 전체 타임라인 조회", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "323608526",
    });
    await endSession(sess.id, s.tenantId, { description: "점검" });

    const perCust = await listCustomerSessions(s.customerId, s.tenantId);
    expect(perCust.length).toBe(1);
    expect(perCust[0].operatorName).toBe("재성"); // 우리측 담당자 자동

    const timeline = await listRecentSessions(s.tenantId);
    expect(timeline.length).toBe(1);
    expect(timeline[0].customer?.name).toBe("도덕봉가든");

    // remoteId 필터 = 그 거래처만 (HQ 거래처 카드 지원이력 — HQ 는 remoteId 만 가짐)
    const byRemote = await listRecentSessions(s.tenantId, 100, "323608526");
    expect(byRemote.length).toBe(1);
    const emptyRemote = await listRecentSessions(s.tenantId, 100, "999999999");
    expect(emptyRemote.length).toBe(0);
  });

  it("짧은 오접속은 discard 로 삭제", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "323608526",
    });
    await discardSession(sess.id, s.tenantId);
    expect(await row(sess.id)).toBeUndefined();
  });
});

describe("POST /api/sessions — remoteId 시작 + 내부기기/미등록 스킵", () => {
  async function bearer(s: { tenantId: string; operatorId: string }) {
    const { token } = await signApiToken(
      {
        uid: s.operatorId,
        email: "op1",
        displayName: "재성",
        role: "operator",
        tenantId: s.tenantId,
      },
      "22222222-2222-2222-2222-222222222222",
    );
    // 좌석 행 필요(A2-03 수정 이후) — 실 발급 경로도 좌석을 먼저 잡는다.
    await testDb()
      .insert(activeLoginSessions)
      .values({
        userId: s.operatorId,
        jti: "22222222-2222-2222-2222-222222222222",
        deviceId: "test-dev",
        deviceLabel: "test",
      })
      .onConflictDoNothing();
    return token;
  }
  async function post(token: string, remoteId: string, connDirect?: boolean) {
    const req = new Request("http://t/api/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(
        connDirect === undefined ? { remoteId } : { remoteId, connDirect },
      ),
    });
    const res = await startSessionRoute(req);
    return { status: res.status, json: await res.json() };
  }

  it("정상 거래처 → 세션 생성(sessionId 반환)", async () => {
    const s = await seed();
    const r = await post(await bearer(s), "323608526");
    expect(r.status).toBe(201);
    expect(typeof r.json.sessionId).toBe("string");
  });

  it("★종료 보고로 connDirect 가 채워지고, 내용 보강 저장이 그 값을 지우지 않는다", async () => {
    // direct 는 원격 창이 뜬 *뒤* 연결이 수립되며 정해진다 — 시작 보고 땐 아직 모른다
    // (2026-08-11 실측: 시작 시점에 넣었더니 전부 NULL 이었다). 그래서 종료 보고로 채운다.
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "323608526",
    });
    expect((await row(sess.id)).connDirect).toBeNull();

    await endSession(sess.id, s.tenantId, { connDirect: false });
    expect((await row(sess.id)).connDirect).toBe(false);

    // 모달에서 A/S 내용을 나중에 저장하는 두 번째 호출 — connDirect 는 안 실려 온다.
    await endSession(sess.id, s.tenantId, { description: "프린터 재설치" });
    const after = await row(sess.id);
    expect(after.connDirect).toBe(false); // 지워지면 안 된다
    expect(after.description).toBe("프린터 재설치");
  });

  it("직결/릴레이(connDirect)를 세션에 남긴다 — 안 보내면 NULL(구버전 HQ)", async () => {
    // 릴레이 비중이 곧 우리 트래픽 비용이라 실측이 필요하다(마이그038). 구버전 HQ 는 이 값을
    // 안 보내므로 NULL 로 남고, 통계에서 자연히 빠진다.
    // 거래처를 셋으로 나누는 이유: 같은 직원·거래처엔 활성 세션이 하나만 생긴다(마이그025).
    const s = await seed();
    const db = testDb();
    await db.insert(customers).values([
      { tenantId: s.tenantId, name: "릴레이집", remoteId: "111111111" },
      { tenantId: s.tenantId, name: "미보고집", remoteId: "222222222" },
    ]);
    const token = await bearer(s);

    await post(token, "323608526", true);
    await post(token, "111111111", false);
    await post(token, "222222222");

    const rows = await db
      .select()
      .from(supportSessions)
      .where(eq(supportSessions.tenantId, s.tenantId));
    const byRemote = new Map(rows.map((r) => [r.remoteId, r.connDirect]));
    expect(byRemote.get("323608526")).toBe(true);
    expect(byRemote.get("111111111")).toBe(false);
    expect(byRemote.get("222222222")).toBeNull();
  });

  it("★내부기기(is_internal) → 기록 안 함(skipped:internal)", async () => {
    const s = await seed();
    const db = testDb();
    await db
      .insert(customers)
      .values({
        tenantId: s.tenantId,
        name: "내 맥북",
        remoteId: "445497547",
        isInternal: true,
      });
    const r = await post(await bearer(s), "445497547");
    expect(r.json.sessionId).toBeNull();
    expect(r.json.skipped).toBe("internal");
  });

  it("미등록 peer → 기록 안 함(skipped:unknown)", async () => {
    const s = await seed();
    const r = await post(await bearer(s), "999999999");
    expect(r.json.sessionId).toBeNull();
    expect(r.json.skipped).toBe("unknown");
  });
});
