// 직원별 즐겨찾기 데이터 레이어 — 본사 앱과 패널 양쪽 공유.
// 마이그레이션: db/migrations/005_user_favorites.sql

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, userFavorites } from "@/lib/schema";

/** 본사 앱의 "즐겨찾기" 탭 — 내가 즐겨찾기한 거래처 전체 정보 + 추가 시각 */
export async function listMyFavorites(userId: string, tenantId: string) {
  return db
    .select({
      customer: customers,
      favoritedAt: userFavorites.createdAt,
    })
    .from(userFavorites)
    .innerJoin(customers, eq(customers.id, userFavorites.customerId))
    .where(
      and(eq(userFavorites.userId, userId), eq(userFavorites.tenantId, tenantId)),
    )
    .orderBy(desc(userFavorites.createdAt));
}

/** 거래처가 내 즐겨찾기에 있는지 — UI 별표 토글 상태 표시용 */
export async function isFavorited(
  userId: string,
  customerId: string,
): Promise<boolean> {
  const rows = await db
    .select({ userId: userFavorites.userId })
    .from(userFavorites)
    .where(and(eq(userFavorites.userId, userId), eq(userFavorites.customerId, customerId)))
    .limit(1);
  return rows.length > 0;
}

/** 즐겨찾기 추가 — 중복은 idempotent (PK 충돌 무시) */
export async function addFavorite(
  userId: string,
  customerId: string,
  tenantId: string,
): Promise<void> {
  await db
    .insert(userFavorites)
    .values({ userId, customerId, tenantId })
    .onConflictDoNothing();
}

/** 즐겨찾기 제거 — 없어도 idempotent */
export async function removeFavorite(
  userId: string,
  customerId: string,
): Promise<void> {
  await db
    .delete(userFavorites)
    .where(and(eq(userFavorites.userId, userId), eq(userFavorites.customerId, customerId)));
}

/** 관리 패널 — 특정 거래처를 즐겨찾기한 직원 목록 */
export async function listFavoritersOfCustomer(customerId: string, tenantId: string) {
  return db
    .select({
      userId: userFavorites.userId,
      favoritedAt: userFavorites.createdAt,
    })
    .from(userFavorites)
    .where(
      and(
        eq(userFavorites.customerId, customerId),
        eq(userFavorites.tenantId, tenantId),
      ),
    )
    .orderBy(desc(userFavorites.createdAt));
}
