// 좌석 상한(마이그 027) 테스트 — 아이디 무제한 생성으로 과금이 새는 걸 막는다.
//   assertSeatAvailable: 활성 아이디 수가 max_seats 이상이면 throw.
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { tenants, users } from "@/lib/schema";
import { assertSeatAvailable } from "@/lib/data/users";

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
