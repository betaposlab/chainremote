import { describe, it, expect } from "vitest";
import { testDb } from "./helpers/db";
import { addFavoriteByRemoteId, listMyFavorites } from "@/lib/data/favorites";
import { tenants, users, customers } from "@/lib/schema";

// ★ 2026-07-07 실사고 회귀 테스트.
// meta(hostname/alias) 없이 즐겨찾기하면 onConflictDoUpdate 의 set 이 빈 객체 {} 가 되어
// Drizzle 이 "No values to set" 500 을 던졌다(충돌 여부 무관, 쿼리 빌드 시점). 그래서 로컬
// 캐시가 없는 "첫 즐겨찾기"가 대부분 조용히 실패했고, 클라의 post_request 가 상태코드를
// 버려 "성공"으로 오인했다. 지금은 빈 set 대신 no-op(excluded.remote_id) 로 항상 유효.

async function seed(slug: string, email: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({ tenantId: t.id, email, passwordHash: "x", displayName: email })
    .returning({ id: users.id });
  return { tenantId: t.id, userId: u.id };
}

describe("즐겨찾기 — meta 없는 첫 즐겨찾기가 실패하면 안 됨", () => {
  it("meta 없이 addFavorite 이 성공한다 (No values to set 회귀)", async () => {
    const { tenantId, userId } = await seed("betapos", "chang");
    // meta 미전달 = 옛날 크래시 경로
    await expect(
      addFavoriteByRemoteId(userId, "77138120", tenantId),
    ).resolves.toBeDefined();
    const favs = await listMyFavorites(userId, tenantId);
    expect(favs.map((f) => f.remoteId)).toContain("77138120");
  });

  it("같은 remoteId 재즐겨찾기(meta 없음)도 크래시 없이 멱등", async () => {
    const { tenantId, userId } = await seed("betapos", "chang");
    await addFavoriteByRemoteId(userId, "77138120", tenantId);
    await expect(
      addFavoriteByRemoteId(userId, "77138120", tenantId),
    ).resolves.toBeDefined();
    const favs = await listMyFavorites(userId, tenantId);
    expect(favs.filter((f) => f.remoteId === "77138120").length).toBe(1);
  });

  it("customers 에 없는 orphan 도 즐겨찾기 가능(matched=false)", async () => {
    const { tenantId, userId } = await seed("betapos", "chang");
    const r = await addFavoriteByRemoteId(userId, "999888777", tenantId);
    expect(r.matched).toBe(false);
    const favs = await listMyFavorites(userId, tenantId);
    const orphan = favs.find((f) => f.remoteId === "999888777");
    expect(orphan).toBeDefined();
    expect(orphan?.customer).toBeNull(); // 거래처 연결 없음
  });

  it("등록 거래처를 즐겨찾기하면 customer 정보가 붙고 matched=true", async () => {
    const db = testDb();
    const { tenantId, userId } = await seed("betapos", "chang");
    await db
      .insert(customers)
      .values({ tenantId, name: "부엌", remoteId: "77138120" });
    const r = await addFavoriteByRemoteId(userId, "77138120", tenantId);
    expect(r.matched).toBe(true);
    const favs = await listMyFavorites(userId, tenantId);
    const f = favs.find((x) => x.remoteId === "77138120");
    expect(f?.customer?.name).toBe("부엌");
  });

  it("테넌트 격리 — 다른 회사 사용자의 즐겨찾기는 안 보인다", async () => {
    const a = await seed("tenant-a", "userA");
    const b = await seed("tenant-b", "userB");
    await addFavoriteByRemoteId(a.userId, "111", a.tenantId);
    await addFavoriteByRemoteId(b.userId, "222", b.tenantId);
    const favA = await listMyFavorites(a.userId, a.tenantId);
    expect(favA.map((f) => f.remoteId)).toEqual(["111"]); // b 것 안 섞임
  });
});
