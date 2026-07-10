import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { deleteTenantCascade } from "@/lib/data/tenants";
import { registerHeartbeatToken, recordHeartbeat } from "@/lib/data/customers";
import { tenants, users, customers, userFavorites } from "@/lib/schema";

// 회사(tenant) 삭제 = cascade. 소속 사용자·거래처·즐겨찾기가 tenant_id FK(onDelete cascade)로
//   함께 사라지는지, 그리고 ★다른 회사 데이터는 절대 안 건드리는지를 못박는다.

async function seedTenant(slug: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  const [owner] = await db
    .insert(users)
    .values({
      tenantId: t.id,
      email: `owner-${slug}`,
      displayName: `owner-${slug}`,
      passwordHash: "x",
      role: "owner",
    })
    .returning({ id: users.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name: `cust-${slug}`, remoteId: `ID${slug}` })
    .returning({ id: customers.id });
  await db.insert(userFavorites).values({
    tenantId: t.id,
    userId: owner.id,
    remoteId: `ID${slug}`,
    customerId: c.id,
  });
  return { tenantId: t.id, ownerId: owner.id, customerId: c.id };
}

async function counts(tenantId: string) {
  const db = testDb();
  const u = await db.select().from(users).where(eq(users.tenantId, tenantId));
  const c = await db
    .select()
    .from(customers)
    .where(eq(customers.tenantId, tenantId));
  const f = await db
    .select()
    .from(userFavorites)
    .where(eq(userFavorites.tenantId, tenantId));
  const t = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  return { users: u.length, customers: c.length, favs: f.length, tenant: t.length };
}

describe("deleteTenantCascade — 회사 완전 삭제", () => {
  it("소속 사용자·거래처·즐겨찾기까지 cascade 삭제하고 개수를 돌려준다", async () => {
    const a = await seedTenant("del-a");
    expect(await counts(a.tenantId)).toEqual({ users: 1, customers: 1, favs: 1, tenant: 1 });

    const r = await deleteTenantCascade(a.tenantId);
    expect(r.deletedCustomers).toBe(1);
    expect(await counts(a.tenantId)).toEqual({ users: 0, customers: 0, favs: 0, tenant: 0 });
  });

  it("★다른 회사 데이터는 절대 안 건드린다 (테넌트 격리)", async () => {
    const a = await seedTenant("del-b");
    const b = await seedTenant("keep-b");
    // b 거래처에 heartbeat 흔적까지 남겨 실사용 상태로.
    const tok = await registerHeartbeatToken("IDkeep-b");
    await recordHeartbeat("IDkeep-b", tok!, "1.4.53", undefined, "x64");

    await deleteTenantCascade(a.tenantId);

    expect(await counts(a.tenantId)).toEqual({ users: 0, customers: 0, favs: 0, tenant: 0 });
    // b 는 그대로.
    expect(await counts(b.tenantId)).toEqual({ users: 1, customers: 1, favs: 1, tenant: 1 });
  });
});
