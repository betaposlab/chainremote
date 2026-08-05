import { describe, it, expect } from "vitest";
import { testDb } from "./helpers/db";
import {
  addFavoriteByRemoteId,
  listMyFavorites,
  listOrphanFavorites,
  linkFavoritesToCustomer,
} from "@/lib/data/favorites";
import { deleteCustomer } from "@/lib/data/customers";
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

// ★ 2026-08-05 실사고 회귀 테스트 — 지운 거래처가 "신규 후보"로 부활.
//   봉스푸드(포스 철거로 삭제)가 다음 화면에서 "신규 거래처 후보 · 이름 미상"으로 다시 떴다.
//   user_favorites.customer_id FK 가 onDelete:"set null" 이라 거래처만 지우면 즐겨찾기 행이
//   customer_id=NULL 로 남고, listOrphanFavorites 는 그걸 "아직 등록 안 된 신규 후보"로 읽는다.
//   삭제 = "이 기기를 목록에서 뺀다" 이므로 즐겨찾기까지 걷어내야 한다.
describe("거래처 삭제 — 즐겨찾기 잔재로 부활하지 않는다", () => {
  it("삭제하면 그 거래처의 즐겨찾기도 사라져 orphan 후보로 안 뜬다", async () => {
    const db = testDb();
    const { tenantId, userId } = await seed("betapos-del", "chang-del");
    const [c] = await db
      .insert(customers)
      .values({ tenantId, name: "봉스푸드", remoteId: "209780490" })
      .returning({ id: customers.id });

    // 직원이 즐겨찾기 → 거래처에 연결된 상태
    await addFavoriteByRemoteId(userId, "209780490", tenantId);
    await linkFavoritesToCustomer("209780490", c.id, tenantId);
    expect(await listOrphanFavorites(tenantId)).toHaveLength(0);

    // 포스 철거로 거래처 삭제
    expect(await deleteCustomer(c.id, { tenantId })).toBe(true);

    // 부활하면 안 된다
    const orphans = await listOrphanFavorites(tenantId);
    expect(orphans.map((o) => o.remoteId)).not.toContain("209780490");
    expect(orphans).toHaveLength(0);
  });

  it("거래처 등록 전에 찍힌 즐겨찾기(customer_id 미연결)도 같이 걷어낸다", async () => {
    const db = testDb();
    const { tenantId, userId } = await seed("betapos-del2", "chang-del2");
    // 직원이 먼저 즐겨찾기(=orphan) → 나중에 같은 ID 로 거래처 등록했지만 링크는 안 된 상태
    await addFavoriteByRemoteId(userId, "331122334", tenantId);
    const [c] = await db
      .insert(customers)
      .values({ tenantId, name: "링크안된곳", remoteId: "331122334" })
      .returning({ id: customers.id });

    expect(await deleteCustomer(c.id, { tenantId })).toBe(true);
    expect(await listOrphanFavorites(tenantId)).toHaveLength(0);
  });

  it("다른 거래처의 즐겨찾기는 건드리지 않는다", async () => {
    const db = testDb();
    const { tenantId, userId } = await seed("betapos-del3", "chang-del3");
    const [gone] = await db
      .insert(customers)
      .values({ tenantId, name: "지울곳", remoteId: "100000001" })
      .returning({ id: customers.id });
    await addFavoriteByRemoteId(userId, "100000001", tenantId);
    await addFavoriteByRemoteId(userId, "100000002", tenantId); // 남아야 할 남의 후보

    await deleteCustomer(gone.id, { tenantId });

    const orphans = await listOrphanFavorites(tenantId);
    expect(orphans.map((o) => o.remoteId)).toEqual(["100000002"]);
  });
});
