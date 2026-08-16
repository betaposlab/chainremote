import { describe, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { startSession, closeOrphanSessions } from "@/lib/data/sessions";
import { activeLoginSessions, tenants, users, customers, supportSessions } from "@/lib/schema";

// A5 감사 — HQ 세션 기록의 "start POST 레이스 → 영구 고아" 가설을 pglite 로 재현.
//
// 배경: Flutter 쪽 _resolveSid 는 sessionStart POST 응답을 3초만 기다린다. 그 안에 응답이
// 안 오면 크라이언트는 sessionId 를 영원히 모른다(재조회 안 함) → crSessionEndAuto 가 나중에
// 창을 닫아도 sid 가 비어 있어 /end 를 못 부른다. 서버엔 in_progress 행이 남는다.
//
// closeOrphanSessions(2026-08-15 도입)가 이런 고아를 청소하는데, 판정 기준이 "그 직원의
// 좌석(active_login_sessions) 하트비트가 죽었는가"다. 그런데 좌석은 로그인(HQ 앱 전체) 단위지
// 개별 원격 세션 단위가 아니다 — HQ 가 계속 켜져 있으면(다른 창으로 정상 작업 중이어도) 좌석은
// 계속 살아있고, 이 특정 세션만 고아인 채로 아래 테스트가 보여주듯 전혀 청소되지 않는다.

async function seed() {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug: "a5audit", displayName: "a5audit" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({
      tenantId: t.id,
      email: "op-a5",
      displayName: "감사대상",
      passwordHash: "x",
      role: "operator",
    })
    .returning({ id: users.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name: "감사거래처", remoteId: "999000111" })
    .returning({ id: customers.id });
  return { tenantId: t.id, operatorId: u.id, customerId: c.id };
}

async function row(id: string) {
  const db = testDb();
  const [r] = await db.select().from(supportSessions).where(eq(supportSessions.id, id)).limit(1);
  return r;
}

describe("A5 — start POST 레이스가 만든 고아 세션과 closeOrphanSessions 의 사각지대", () => {
  it("★확정: 좌석(HQ)이 살아있으면 2분 넘은 in_progress 세션도 자동 마감되지 않는다", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "999000111",
    });

    // 클라이언트가 sessionId 를 놓친 상황을 흉내: started_at 을 3분 전으로 되돌려
    // "시작 2분 미만은 건너뛴다" 가드를 통과시킨다. 실제로는 3초 타임아웃 레이스가 원인이라
    // 이 값을 직접 조작하는 대신 그냥 오래된 세션으로 취급한다(가설 자체는 started_at 과 무관).
    await testDb()
      .update(supportSessions)
      .set({ startedAt: sql`now() - interval '3 minutes'` })
      .where(eq(supportSessions.id, sess.id));

    // 좌석은 방금 하트비트를 보낸 상태로 유지(=HQ 가 켜져 있고 직원이 다른 화면에서 정상 작업 중).
    await testDb()
      .insert(activeLoginSessions)
      .values({
        userId: s.operatorId,
        jti: "11111111-1111-1111-1111-111111111111",
        deviceId: "hq-alive",
        deviceLabel: "재성 HQ",
      })
      .onConflictDoUpdate({
        target: activeLoginSessions.userId,
        set: { lastSeenAt: sql`now()` },
      });

    const closed = await closeOrphanSessions(s.tenantId);
    expect(closed).toBe(0);

    const r = await row(sess.id);
    // ★결과: HQ 직원 관점 — 실제로는 그 세션의 원격 창이 이미 사라졌는데, 패널·본사 앱
    // presence 는 "지원 중"으로 계속 표시된다. 직원이 로그아웃하거나 HQ 를 완전히 끌 때까지
    // (좌석 하트비트가 끊길 때까지) 이 상태가 무기한 지속된다.
    expect(r.endedAt).toBeNull();
  });

  it("대조군: 좌석이 죽으면(로그아웃/HQ 종료) 같은 세션이 정상적으로 자동 마감된다", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "999000111",
    });
    await testDb()
      .update(supportSessions)
      .set({ startedAt: sql`now() - interval '3 minutes'` })
      .where(eq(supportSessions.id, sess.id));

    // 좌석 하트비트가 2분 넘게 안 온 상태(=HQ 가 죽었거나 로그아웃).
    await testDb()
      .insert(activeLoginSessions)
      .values({
        userId: s.operatorId,
        jti: "22222222-2222-2222-2222-222222222222",
        deviceId: "hq-dead",
        deviceLabel: "재성 HQ",
        lastSeenAt: sql`now() - interval '5 minutes'`,
      })
      .onConflictDoUpdate({
        target: activeLoginSessions.userId,
        set: { lastSeenAt: sql`now() - interval '5 minutes'` },
      });

    const closed = await closeOrphanSessions(s.tenantId);
    expect(closed).toBe(1);

    const r = await row(sess.id);
    expect(r.endedAt).not.toBeNull();
    // resolution 은 건드리지 않는다는 설계 그대로인지 — 자동마감이 "해결"로 둔갑하면 안 된다.
    expect(r.resolution).toBe("in_progress");
  });

  it("경계 확인: 시작 2분 미만은 좌석이 죽었어도 건드리지 않는다(로그인 직후 경합 여유)", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "999000111",
    });
    // startedAt 을 건드리지 않음 = 방금 시작.
    // 좌석 자체를 아예 안 만듦 = "좌석 없음"과 동일 조건.
    const closed = await closeOrphanSessions(s.tenantId);
    expect(closed).toBe(0);
    expect((await row(sess.id)).endedAt).toBeNull();
  });
});
