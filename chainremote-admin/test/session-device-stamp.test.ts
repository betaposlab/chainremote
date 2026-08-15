import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { createManualSession, searchSessions, startSession } from "@/lib/data/sessions";
import { activeLoginSessions, customers, tenants, users } from "@/lib/schema";

// 마이그046 — 세션 시작 때 그 직원의 좌석(호스트명·IP)을 복사한다.
//   좌석은 계정당 한 줄이라 다음 로그인에 덮어써진다 → 세션마다 그때 값을 남겨야
//   "어느 PC 에서 봤나"(PC방 ChainGo / 집 / 사무실)를 나중에 답할 수 있다.

async function seed() {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug: "dev", displayName: "dev" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({ tenantId: t.id, email: "jaesung", displayName: "재성", passwordHash: "x", role: "operator" })
    .returning({ id: users.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name: "토니피자", remoteId: "211191101" })
    .returning({ id: customers.id });
  return { db, tenantId: t.id, operatorId: u.id, customerId: c.id };
}

async function seat(userId: string, label: string, ip: string) {
  await testDb().insert(activeLoginSessions).values({
    userId,
    jti: "00000000-0000-4000-8000-000000000001",
    deviceId: "dev-1",
    deviceLabel: label,
    ip,
    lastSeenAt: sql`now()`,
  });
}

describe("접속 기기 스탬프", () => {
  it("좌석의 호스트명·IP 가 세션에 박힌다", async () => {
    const s = await seed();
    await seat(s.operatorId, "desktop-1a8l3cv", "182.210.192.200");
    const sess = await startSession({ ...s, remoteId: "211191101" });
    expect(sess.operatorDevice).toBe("desktop-1a8l3cv");
    expect(sess.operatorIp).toBe("182.210.192.200");
  });

  it("★좌석이 덮어써져도 옛 세션의 스탬프는 그대로 — 이게 이 기능의 존재 이유", async () => {
    const s = await seed();
    await seat(s.operatorId, "pcbang-07", "1.2.3.4"); // PC방에서 ChainGo
    const first = await startSession({ ...s, remoteId: "211191101" });
    // 나중에 집에서 다시 로그인(좌석 한 줄이 덮어써진다)
    await testDb()
      .update(activeLoginSessions)
      .set({ deviceLabel: "home-pc", ip: "112.186.209.131" });
    const rows = await searchSessions({ tenantId: s.tenantId, period: "all" });
    const row = rows.find((r) => r.id === first.id)!;
    expect(row.operatorDevice).toBe("pcbang-07");
    expect(row.operatorIp).toBe("1.2.3.4");
  });

  it("좌석이 없으면(옛 경로 로그인) 비워 두고, 세션 기록 자체는 막지 않는다", async () => {
    const s = await seed();
    const sess = await startSession({ ...s, remoteId: "211191101" });
    expect(sess.operatorDevice).toBeNull();
    expect(sess.operatorIp).toBeNull();
    expect(sess.id).toBeTruthy();
  });

  it("수동 기록은 원격이 아니므로 기기 스탬프가 없다", async () => {
    const s = await seed();
    await seat(s.operatorId, "desktop-1a8l3cv", "182.210.192.200");
    const r = await createManualSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      startedAt: new Date("2026-08-15T05:00:00Z"),
      endedAt: new Date("2026-08-15T05:20:00Z"),
      fields: { description: "전화 안내" },
    });
    expect(r.operatorDevice).toBeNull();
    expect(r.operatorIp).toBeNull();
  });
});
