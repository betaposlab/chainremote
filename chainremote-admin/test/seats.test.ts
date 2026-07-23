// 좌석 상한(마이그 027) 테스트 — 아이디 무제한 생성으로 과금이 새는 걸 막는다.
//   assertSeatAvailable: 활성 아이디 수가 max_seats 이상이면 throw.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { tenants, users, activeLoginSessions } from "@/lib/schema";
import { assertSeatAvailable } from "@/lib/data/users";
import { countLiveTenantSessions } from "@/lib/data/active-sessions";

const NOBODY = "00000000-0000-0000-0000-000000000000"; // 아무도 제외 안 하는 더미 userId

// 활성 세션 1건 심기. stale=true 면 3분 전 last_seen(orphan, 2분 TTL 초과).
async function mkSession(userId: string, stale = false) {
  await testDb()
    .insert(activeLoginSessions)
    .values({
      userId,
      jti: randomUUID(),
      deviceId: "dev-" + userId,
      lastSeenAt: stale ? new Date(Date.now() - 3 * 60_000) : new Date(),
    });
}

async function mkTenant(slug: string, maxSeats: number): Promise<string> {
  const [t] = await testDb()
    .insert(tenants)
    .values({ slug, displayName: slug, isActive: true, subscriptionStatus: "active", maxSeats })
    .returning({ id: tenants.id });
  return t.id;
}
async function mkUser(
  tenantId: string,
  email: string,
  isActive = true,
): Promise<string> {
  const [u] = await testDb()
    .insert(users)
    .values({ tenantId, email, passwordHash: "x", displayName: email, role: "operator", isActive })
    .returning({ id: users.id });
  return u.id;
}

describe("좌석 상한 (assertSeatAvailable)", () => {
  it("1석인데 이미 활성 1명이면 추가 거부", async () => {
    const t = await mkTenant("seat1", 1);
    await mkUser(t, "a@seat1"); // 좌석 1/1
    await expect(assertSeatAvailable(t)).rejects.toThrow(/좌석/);
  });

  it("좌석에 여유가 있으면 통과", async () => {
    const t = await mkTenant("seat2", 3);
    await mkUser(t, "a@seat2");
    await mkUser(t, "b@seat2"); // 2/3
    await expect(assertSeatAvailable(t)).resolves.toBeUndefined();
  });

  it("좌석을 늘리면(상한 상향) 다시 추가 가능", async () => {
    const t = await mkTenant("seat3", 1);
    await mkUser(t, "a@seat3");
    await expect(assertSeatAvailable(t)).rejects.toThrow(); // 1/1 막힘
    await testDb().update(tenants).set({ maxSeats: 2 }).where(eq(tenants.id, t));
    await expect(assertSeatAvailable(t)).resolves.toBeUndefined(); // 1/2 통과
  });

  it("비활성 아이디는 좌석을 안 먹는다", async () => {
    const t = await mkTenant("seat4", 1);
    await mkUser(t, "a@seat4", false); // 비활성 → 좌석 0
    await expect(assertSeatAvailable(t)).resolves.toBeUndefined();
  });

  it("비활성→활성 전환 검사: 자기 제외하고 상한 미만이어야", async () => {
    const t = await mkTenant("seat5", 1);
    const active = await mkUser(t, "a@seat5", true); // 활성 1
    const dormant = await mkUser(t, "b@seat5", false); // 비활성
    // dormant 를 활성화하려는 검사: dormant 제외한 활성 수(=1) >= 1 → 거부
    await expect(assertSeatAvailable(t, dormant)).rejects.toThrow();
    // active 자신을 제외하면 활성 0 → 통과(이미 활성인 걸 저장하는 경우)
    await expect(assertSeatAvailable(t, active)).resolves.toBeUndefined();
  });

  it("본사(9999석)는 사실상 무제한", async () => {
    const t = await mkTenant("seat6", 9999);
    for (let i = 0; i < 5; i++) await mkUser(t, `u${i}@seat6`);
    await expect(assertSeatAvailable(t)).resolves.toBeUndefined();
  });

  it("마이그 027: max_seats 기본값 1", async () => {
    const [t] = await testDb()
      .insert(tenants)
      .values({ slug: "seat7", displayName: "seat7" })
      .returning({ maxSeats: tenants.maxSeats });
    expect(t.maxSeats).toBe(1);
  });
});

describe("넷플릭스식 동시 접속 총량 (countLiveTenantSessions)", () => {
  it("살아있는 세션만 세고 본인은 제외", async () => {
    const t = await mkTenant("live1", 2);
    const u1 = await mkUser(t, "u1@live1");
    const u2 = await mkUser(t, "u2@live1");
    const u3 = await mkUser(t, "u3@live1");
    await mkSession(u1);
    await mkSession(u2); // u1,u2 접속 중 (2/2), u3 미접속
    // u3 로그인 관점: 자기 제외 살아있는 세션 = 2 → 좌석(2) 꽉 참 → 거부돼야
    expect(await countLiveTenantSessions(t, u3)).toBe(2);
    // u1 재로그인 관점: 자기 제외 = 1(u2) → 자기 자리 대체라 허용
    expect(await countLiveTenantSessions(t, u1)).toBe(1);
  });

  it("orphan(2분↑ 무heartbeat) 세션은 안 센다 — 닫고 나가면 좌석 반환", async () => {
    const t = await mkTenant("live2", 2);
    const u1 = await mkUser(t, "u1@live2");
    const u2 = await mkUser(t, "u2@live2");
    await mkSession(u1, true); // orphan(3분 전)
    await mkSession(u2); // 살아있음
    expect(await countLiveTenantSessions(t, NOBODY)).toBe(1); // u2 만
  });

  it("다른 대리점 세션은 안 센다 (tenant 격리)", async () => {
    const t1 = await mkTenant("live3a", 2);
    const t2 = await mkTenant("live3b", 2);
    const u1 = await mkUser(t1, "u1@live3a");
    const u2 = await mkUser(t2, "u2@live3b");
    await mkSession(u1);
    await mkSession(u2);
    expect(await countLiveTenantSessions(t1, NOBODY)).toBe(1); // t1 의 u1 만
  });
});
