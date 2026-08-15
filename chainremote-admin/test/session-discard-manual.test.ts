import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  createManualSession,
  discardSession,
  discardSessionSoft,
  listActiveSessions,
  listCustomerSessions,
  listRecentSessions,
  restoreSession,
  searchSessions,
  startSession,
  updateSessionRecord,
} from "@/lib/data/sessions";
import { customers, supportSessions, tenants, users } from "@/lib/schema";

// 마이그045 — 폐기는 삭제가 아니라 표식 / 사후 편집 / 수동 기록.
//   규칙(2026-08-15 Chang): 15초 이상 원격 사실은 반드시 남는다. 15초 미만만 진짜 지운다(HQ).

async function seed() {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug: "dm", displayName: "dm" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({ tenantId: t.id, email: "jaesung", displayName: "재성", passwordHash: "x", role: "operator" })
    .returning({ id: users.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name: "토니피자", remoteId: "211191101" })
    .returning({ id: customers.id });
  return { tenantId: t.id, operatorId: u.id, customerId: c.id };
}

async function row(id: string) {
  const [r] = await testDb().select().from(supportSessions).where(eq(supportSessions.id, id)).limit(1);
  return r;
}

describe("기록 폐기 = 숨김 표식", () => {
  it("패널 폐기(soft)는 행을 남기고 discarded_at 만 박는다 — 진행 중이면 그 시각에 끝낸다", async () => {
    const s = await seed();
    const sess = await startSession({ ...s, remoteId: "211191101" });
    await discardSessionSoft(sess.id, s.tenantId);
    const r = await row(sess.id);
    expect(r).toBeTruthy();
    expect(r.discardedAt).not.toBeNull();
    expect(r.endedAt).not.toBeNull();
    // 활성 표시에서 사라진다.
    expect(await listActiveSessions(s.tenantId)).toHaveLength(0);
  });

  it("기본 조회(검색·HQ 이력·거래처 이력)에선 숨고, includeDiscarded 로만 보인다", async () => {
    const s = await seed();
    const sess = await startSession({ ...s, remoteId: "211191101" });
    await discardSessionSoft(sess.id, s.tenantId);
    expect(await searchSessions({ tenantId: s.tenantId, period: "all" })).toHaveLength(0);
    expect(await listRecentSessions(s.tenantId)).toHaveLength(0);
    expect(await listCustomerSessions(s.customerId, s.tenantId)).toHaveLength(0);
    const withDiscarded = await searchSessions({
      tenantId: s.tenantId,
      period: "all",
      includeDiscarded: true,
    });
    expect(withDiscarded).toHaveLength(1);
    expect(withDiscarded[0].discardedAt).not.toBeNull();
  });

  it("폐기 취소로 되살아난다", async () => {
    const s = await seed();
    const sess = await startSession({ ...s, remoteId: "211191101" });
    await discardSessionSoft(sess.id, s.tenantId);
    await restoreSession(sess.id, s.tenantId);
    expect((await row(sess.id)).discardedAt).toBeNull();
    expect(await searchSessions({ tenantId: s.tenantId, period: "all" })).toHaveLength(1);
  });

  it("HQ 의 15초 미만 폐기(hard)는 여전히 진짜 지운다 — 규칙대로", async () => {
    const s = await seed();
    const sess = await startSession({ ...s, remoteId: "211191101" });
    await discardSession(sess.id, s.tenantId);
    expect(await row(sess.id)).toBeUndefined();
  });

  it("다른 테넌트는 폐기·복원 못 한다", async () => {
    const s = await seed();
    const sess = await startSession({ ...s, remoteId: "211191101" });
    await discardSessionSoft(sess.id, "00000000-0000-4000-8000-00000000dead");
    expect((await row(sess.id)).discardedAt).toBeNull();
  });
});

describe("사후 편집", () => {
  it("끝난 미기록 세션에 내용을 채운다 — 시간은 안 건드린다", async () => {
    const s = await seed();
    const sess = await startSession({ ...s, remoteId: "211191101" });
    await discardSessionSoft(sess.id, s.tenantId); // ended_at 을 박는 가장 짧은 길
    await restoreSession(sess.id, s.tenantId);
    const before = await row(sess.id);
    await updateSessionRecord(sess.id, s.tenantId, {
      issueType: "hardware",
      resolution: "resolved",
      contactName: " 김점장 ",
      categories: "printer,payment",
      description: "  프린터 IP 재설정 ",
    });
    const r = await row(sess.id);
    expect(r.issueType).toBe("hardware");
    expect(r.resolution).toBe("resolved");
    expect(r.contactName).toBe("김점장");
    expect(r.categories).toBe("printer,payment");
    expect(r.description).toBe("프린터 IP 재설정");
    expect(r.startedAt.getTime()).toBe(before.startedAt.getTime());
    expect(r.endedAt!.getTime()).toBe(before.endedAt!.getTime());
  });

  it("undefined 는 그대로, 빈문자는 비움", async () => {
    const s = await seed();
    const sess = await startSession({ ...s, remoteId: "211191101" });
    await updateSessionRecord(sess.id, s.tenantId, { description: "첫 기록", contactName: "A" });
    await updateSessionRecord(sess.id, s.tenantId, { contactName: "" });
    const r = await row(sess.id);
    expect(r.description).toBe("첫 기록");
    expect(r.contactName).toBeNull();
  });
});

describe("수동 기록", () => {
  it("manual=true 로 남고 시각은 준 값 그대로, remote_id 는 거래처에서 가져온다", async () => {
    const s = await seed();
    const started = new Date("2026-08-15T05:32:00Z");
    const ended = new Date("2026-08-15T05:53:00Z");
    const r = await createManualSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      startedAt: started,
      endedAt: ended,
      fields: { description: "전화로 프린터 안내", resolution: "resolved" },
    });
    expect(r.manual).toBe(true);
    expect(r.remoteId).toBe("211191101");
    expect(r.startedAt.getTime()).toBe(started.getTime());
    expect(r.endedAt!.getTime()).toBe(ended.getTime());
    const rows = await searchSessions({ tenantId: s.tenantId, period: "all" });
    expect(rows).toHaveLength(1);
    expect(rows[0].manual).toBe(true);
    expect(rows[0].durationSec).toBe(21 * 60);
  });

  it("종료가 시작보다 앞서면 거부 / 남의 테넌트 거래처면 거부", async () => {
    const s = await seed();
    await expect(
      createManualSession({
        tenantId: s.tenantId,
        operatorId: s.operatorId,
        customerId: s.customerId,
        startedAt: new Date("2026-08-15T06:00:00Z"),
        endedAt: new Date("2026-08-15T05:00:00Z"),
      }),
    ).rejects.toThrow();
    await expect(
      createManualSession({
        tenantId: "00000000-0000-4000-8000-00000000dead",
        operatorId: s.operatorId,
        customerId: s.customerId,
        startedAt: new Date("2026-08-15T05:00:00Z"),
        endedAt: new Date("2026-08-15T06:00:00Z"),
      }),
    ).rejects.toThrow();
  });
});
