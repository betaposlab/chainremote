// 직원별 즐겨찾기 데이터 레이어 — 본사 앱과 패널 양쪽 공유.
// 마이그레이션: 005_user_favorites.sql (최초), 008_user_favorites_orphan.sql (remote_id 기반 개편).
//
// 2026-05-27 개편: remote_id 가 primary 식별자. customer_id 는 customers 에 등록된 경우만 채움.
// 옵션 B+ HQ workstation 처럼 customers 에 없는 머신도 즐겨찾기 가능.

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, userFavorites, users } from "@/lib/schema";

/** 본사 앱의 "즐겨찾기" 탭 — 내가 즐겨찾기한 머신 전체.
 * customer 가 customers 에 등록돼 있으면 customer 정보, 아니면 orphan(null). */
export async function listMyFavorites(userId: string, tenantId: string) {
  const rows = await db
    .select({
      remoteId: userFavorites.remoteId,
      customer: customers, // LEFT JOIN → 매칭 없으면 모든 컬럼 null.
      favoritedAt: userFavorites.createdAt,
    })
    .from(userFavorites)
    .leftJoin(customers, eq(customers.id, userFavorites.customerId))
    .where(
      and(eq(userFavorites.userId, userId), eq(userFavorites.tenantId, tenantId)),
    )
    .orderBy(desc(userFavorites.createdAt));

  // Drizzle leftJoin 은 매칭 없을 때 customer 의 모든 필드가 null 인 객체를 반환.
  // 클라이언트가 Option<Customer> 로 해석 가능하도록 명시적 null 로 변환.
  return rows.map((r) => ({
    remoteId: r.remoteId,
    customer: r.customer && r.customer.id ? r.customer : null,
    favoritedAt: r.favoritedAt,
  }));
}

/** 머신이 내 즐겨찾기에 있는지 — UI 별표 토글 상태 표시용. remote_id 기준. */
export async function isFavorited(
  userId: string,
  remoteId: string,
): Promise<boolean> {
  const rows = await db
    .select({ userId: userFavorites.userId })
    .from(userFavorites)
    .where(and(eq(userFavorites.userId, userId), eq(userFavorites.remoteId, remoteId)))
    .limit(1);
  return rows.length > 0;
}

/** 즐겨찾기 추가 — remote_id 기준 idempotent. customers 에 매칭되면 customer_id 도 박음. */
export async function addFavoriteByRemoteId(
  userId: string,
  remoteId: string,
  tenantId: string,
): Promise<{ matched: boolean }> {
  // 1) customers 에 같은 remote_id 가 있으면 customer_id 동기화.
  const matched = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.remoteId, remoteId), eq(customers.tenantId, tenantId)))
    .limit(1);
  const customerId = matched.length > 0 ? matched[0].id : null;

  await db
    .insert(userFavorites)
    .values({ userId, remoteId, customerId, tenantId })
    .onConflictDoNothing();

  return { matched: customerId !== null };
}

/** 즐겨찾기 제거 — remote_id 기준 idempotent. */
export async function removeFavoriteByRemoteId(
  userId: string,
  remoteId: string,
): Promise<void> {
  await db
    .delete(userFavorites)
    .where(and(eq(userFavorites.userId, userId), eq(userFavorites.remoteId, remoteId)));
}

/** 관리 패널 — 특정 거래처를 즐겨찾기한 직원 목록.
 * 거래처 등록된 머신만(customer_id 매칭) 추적 — orphan 즐겨찾기는 customer 없으니 자동 제외. */
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

/** 관리 패널 "신규 거래처 후보" 배너의 데이터 출처.
 * customers 에 아직 없는 orphan 즐겨찾기(customer_id NULL)를 remote_id 로 묶어 반환한다.
 * 출처가 DB(진실 원천)이므로 패널이 NAS 에서 돌든 로컬이든 동일하게 작동한다.
 * (구 lib/peer-discovery.ts 의 로컬 .toml 스캔 방식을 대체 — 그건 패널이 Chang Mac 에서
 *  직접 실행될 때만 동작했고, NAS 컨테이너에선 항상 빈 배열이었음.) */
export type OrphanFavorite = {
  remoteId: string;
  favoritedBy: string[]; // 즐겨찾기한 직원 displayName 목록
  favoritedAt: Date; // 가장 최근 즐겨찾기 시각
};

export async function listOrphanFavorites(
  tenantId: string,
): Promise<OrphanFavorite[]> {
  const rows = await db
    .select({
      remoteId: userFavorites.remoteId,
      displayName: users.displayName,
      favoritedAt: userFavorites.createdAt,
    })
    .from(userFavorites)
    .leftJoin(users, eq(users.id, userFavorites.userId))
    .where(
      and(eq(userFavorites.tenantId, tenantId), isNull(userFavorites.customerId)),
    )
    .orderBy(desc(userFavorites.createdAt));

  // 같은 머신을 여러 직원이 즐겨찾기했을 수 있으니 remote_id 로 그룹핑.
  // rows 가 createdAt desc → 첫 등장이 최신, Map 삽입 순서로 최신순 유지.
  const byRemote = new Map<string, OrphanFavorite>();
  for (const r of rows) {
    const existing = byRemote.get(r.remoteId);
    if (existing) {
      if (r.displayName && !existing.favoritedBy.includes(r.displayName)) {
        existing.favoritedBy.push(r.displayName);
      }
    } else {
      byRemote.set(r.remoteId, {
        remoteId: r.remoteId,
        favoritedBy: r.displayName ? [r.displayName] : [],
        favoritedAt: r.favoritedAt,
      });
    }
  }
  return [...byRemote.values()];
}

/** importPeer/createCustomer 가 remote_id 로 거래처를 만들 때, 같은 remote_id 의
 * orphan 즐겨찾기(customer_id NULL)들을 새 customer 에 연결한다.
 * → "신규 거래처 후보" 배너에서 사라지고, 직원 즐겨찾기 탭엔 거래처 정보가 채워진다. */
export async function linkFavoritesToCustomer(
  remoteId: string,
  customerId: string,
  tenantId: string,
): Promise<void> {
  await db
    .update(userFavorites)
    .set({ customerId })
    .where(
      and(
        eq(userFavorites.tenantId, tenantId),
        eq(userFavorites.remoteId, remoteId),
        isNull(userFavorites.customerId),
      ),
    );
}
