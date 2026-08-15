import { describe, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  closeOrphanSessions,
  listActiveSessions,
  endSession,
  startSession,
} from "@/lib/data/sessions";
import {
  activeLoginSessions,
  customers,
  supportSessions,
  tenants,
  users,
} from "@/lib/schema";

// 고아 세션 자동 마감 — HQ 가 죽어(강제 종료·절전·크래시) 종료 보고를 못 보낸 in_progress
//   세션을 좌석 하트비트(2분 TTL)로 판정해 닫는다. 2026-08-15 토니피자 건이 계기.

async function seed() {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug: "orphan", displayName: "orphan" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({
      tenantId: t.id,
      email: "jaesung",
      displayName: "재성",
      passwordHash: "x",
      role: "operator",
    })
    .returning({ id: users.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name: "토니피자", remoteId: "211191101" })
    .returning({ id: customers.id });
  return { db, tenantId: t.id, operatorId: u.id, customerId: c.id };
}

/** started_at 을 과거로 밀어 "2분 미만 안전 여유"를 벗어나게 한다. */
async function ageSession(id: string, minutesAgo: number) {
  await testDb()
    .update(supportSessions)
    .set({ startedAt: sql`now() - interval '${sql.raw(String(minutesAgo))} minutes'` })
    .where(eq(supportSessions.id, id));
}

async function seat(userId: string, lastSeenMinutesAgo: number) {
  await testDb().insert(activeLoginSessions).values({
    userId,
    jti: "00000000-0000-4000-8000-000000000001",
    deviceId: "dev-1",
    deviceLabel: "desktop-1a8l3cv",
    lastSeenAt: sql`now() - interval '${sql.raw(String(lastSeenMinutesAgo))} minutes'`,
  });
}

async function row(id: string) {
  const [r] = await testDb()
    .select()
    .from(supportSessions)
    .where(eq(supportSessions.id, id))
    .limit(1);
  return r;
}

describe("고아 세션 자동 마감", () => {
  it("좌석 하트비트가 2분 넘게 끊긴 직원의 열린 세션은 닫힌다 — ended_at = 마지막 하트비트", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "211191101",
    });
    await ageSession(sess.id, 90); // 14:32 시작
    await seat(s.operatorId, 60); // HQ 마지막 하트비트 14:53 → 지금은 한 시간 전

    const n = await closeOrphanSessions(s.tenantId);
    expect(n).toBe(1);
    const r = await row(sess.id);
    expect(r.endedAt).not.toBeNull();
    // 종료 시각은 now() 가 아니라 좌석의 마지막 하트비트(≈60분 전).
    const agoMin = (Date.now() - r.endedAt!.getTime()) / 60_000;
    expect(agoMin).toBeGreaterThan(55);
    expect(agoMin).toBeLessThan(65);
    expect(r.durationSec).toBeGreaterThan(25 * 60);
    // 내용은 그대로 비어 있고(미기록), resolution 도 안 건드린다.
    expect(r.description).toBeNull();
    expect(r.resolution).toBe("in_progress");
  });

  it("좌석 행이 아예 없으면(로그아웃 후) now() 로 닫는다", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "211191101",
    });
    await ageSession(sess.id, 10);
    expect(await closeOrphanSessions(s.tenantId)).toBe(1);
    const r = await row(sess.id);
    expect(Date.now() - r.endedAt!.getTime()).toBeLessThan(10_000);
  });

  it("살아있는 HQ(하트비트 2분 내)의 세션은 절대 안 닫는다", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "211191101",
    });
    await ageSession(sess.id, 120);
    await seat(s.operatorId, 0); // 방금 하트비트
    expect(await closeOrphanSessions(s.tenantId)).toBe(0);
    expect((await row(sess.id)).endedAt).toBeNull();
  });

  it("시작 2분 미만은 좌석이 없어도 건너뛴다(로그인 직후 경합 여유)", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "211191101",
    });
    expect(await closeOrphanSessions(s.tenantId)).toBe(0);
    expect((await row(sess.id)).endedAt).toBeNull();
  });

  it("다른 테넌트의 고아 세션은 건드리지 않는다", async () => {
    const a = await seed();
    const db = testDb();
    const [t2] = await db
      .insert(tenants)
      .values({ slug: "other", displayName: "other" })
      .returning({ id: tenants.id });
    const [u2] = await db
      .insert(users)
      .values({ tenantId: t2.id, email: "x", displayName: "x", passwordHash: "x", role: "operator" })
      .returning({ id: users.id });
    const [c2] = await db
      .insert(customers)
      .values({ tenantId: t2.id, name: "남의 가게", remoteId: "999" })
      .returning({ id: customers.id });
    const other = await startSession({
      tenantId: t2.id,
      operatorId: u2.id,
      customerId: c2.id,
      remoteId: "999",
    });
    await ageSession(other.id, 30);
    expect(await closeOrphanSessions(a.tenantId)).toBe(0);
    expect((await row(other.id)).endedAt).toBeNull();
  });

  it("뒤늦게 HQ 가 /end 로 내용을 보강해도 자동 마감 시각은 보존된다", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "211191101",
    });
    await ageSession(sess.id, 90);
    await seat(s.operatorId, 60);
    await closeOrphanSessions(s.tenantId);
    const closed = await row(sess.id);
    await endSession(sess.id, s.tenantId, { description: "프린터 IP 재설정", resolution: "resolved" });
    const after = await row(sess.id);
    expect(after.endedAt!.getTime()).toBe(closed.endedAt!.getTime());
    expect(after.description).toBe("프린터 IP 재설정");
    expect(after.resolution).toBe("resolved");
  });

  it("listActiveSessions 는 읽기 전에 고아를 치운다 — 패널/HQ 의 '지원 중'이 스스로 꺼진다", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "211191101",
    });
    await ageSession(sess.id, 30);
    await seat(s.operatorId, 30);
    const active = await listActiveSessions(s.tenantId);
    expect(active).toHaveLength(0);
  });
});
