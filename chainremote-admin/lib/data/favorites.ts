// 직원별 즐겨찾기 데이터 레이어 — 본사 앱과 패널이 공유.
// 마이그: 005_user_favorites.sql(최초), 008_user_favorites_orphan.sql(remote_id 기반 개편).
//
// 2026-05-27 개편으로 remote_id 가 primary 식별자, customer_id 는 customers 에 등록된 경우만 채운다.
// 덕분에 옵션 B+ HQ workstation 처럼 customers 에 없는 머신도 즐겨찾기할 수 있다.

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, userFavorites, users } from "@/lib/schema";

/** 본사 앱 "즐겨찾기" 탭 — 내가 즐겨찾기한 머신 전체.
 * customers 에 등록된 머신이면 customer 정보, 아니면 orphan(null). */
export async function listMyFavorites(userId: string, tenantId: string) {
  const rows = await db
    .select({
      remoteId: userFavorites.remoteId,
      customer: customers, // LEFT JOIN — 매칭 없으면 모든 컬럼 null
      favoritedAt: userFavorites.createdAt,
    })
    .from(userFavorites)
    .leftJoin(customers, eq(customers.id, userFavorites.customerId))
    .where(
      and(eq(userFavorites.userId, userId), eq(userFavorites.tenantId, tenantId)),
    )
    .orderBy(desc(userFavorites.createdAt));

  // Drizzle leftJoin 은 매칭이 없어도 필드가 전부 null 인 customer 객체를 준다.
  //   클라이언트가 Option<Customer> 로 다루도록 그런 경우는 통째 null 로 바꿔준다.
  return rows.map((r) => ({
    remoteId: r.remoteId,
    customer: r.customer && r.customer.id ? r.customer : null,
    favoritedAt: r.favoritedAt,
  }));
}

/** 이 머신이 내 즐겨찾기에 있는지 — 별표 토글 상태 표시용. remote_id 기준. */
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

/** 즐겨찾기 추가 — remote_id 기준 idempotent. customers 에 매칭되면 customer_id 도 채운다. */
export async function addFavoriteByRemoteId(
  userId: string,
  remoteId: string,
  tenantId: string,
  meta?: { hostname?: string | null; alias?: string | null },
): Promise<{ matched: boolean }> {
  // 1) customers 에 같은 remote_id 가 있으면 customer_id 를 함께 채운다.
  const matched = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.remoteId, remoteId), eq(customers.tenantId, tenantId)))
    .limit(1);
  const customerId = matched.length > 0 ? matched[0].id : null;

  // 2) insert. 충돌 시 meta(hostname/alias)가 있으면 backfill, 없으면 그대로 둔다
  //    — meta 없는 재즐겨찾기가 기존 값을 null 로 덮지 않도록.
  await db
    .insert(userFavorites)
    .values({
      userId,
      remoteId,
      customerId,
      tenantId,
      hostname: meta?.hostname ?? null,
      alias: meta?.alias ?? null,
    })
    .onConflictDoUpdate({
      target: [userFavorites.userId, userFavorites.remoteId],
      set: (meta?.hostname || meta?.alias)
        ? { hostname: meta?.hostname ?? null, alias: meta?.alias ?? null }
        : {},
    });

  // 즐겨찾기 = 차지(claim): 미배정(등록대기) 거래처를 처음 즐겨찾기한 사람이 담당이 된다.
  //   assigned_user_id IS NULL 일 때만 세팅하는 원자적 first-wins. 이미 배정돼 있으면 no-op 이라
  //   다른 직원도 같은 거래처를 공유 즐겨찾기할 수 있다(담당은 그대로). 차지되면 신규 표시가 전 HQ 에서 풀린다.
  if (customerId) {
    await db
      .update(customers)
      .set({ assignedUserId: userId, updatedAt: new Date() })
      .where(and(eq(customers.id, customerId), isNull(customers.assignedUserId)));
  }

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

/** "신규 거래처 후보" 무시/삭제 — 그 remote_id 의 미등록(customer_id NULL) 즐겨찾기를
 *  테넌트 전체에서 지워 후보 배너에서 사라지게 한다. 등록된 거래처(customer_id 있음)의
 *  즐겨찾기는 isNull 게이트로 건드리지 않는다. */
export async function dismissOrphanCandidate(
  tenantId: string,
  remoteId: string,
): Promise<void> {
  await db
    .delete(userFavorites)
    .where(
      and(
        eq(userFavorites.tenantId, tenantId),
        eq(userFavorites.remoteId, remoteId),
        isNull(userFavorites.customerId),
      ),
    );
}

/** 관리 패널 — 이 거래처를 즐겨찾기한 직원 목록.
 * customer_id 로 매칭하므로 등록된 머신만 잡히고 orphan 즐겨찾기는 자동 제외. */
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
 * DB(진실 원천)에서 읽으므로 패널이 NAS 든 로컬이든 똑같이 동작한다.
 * (구 lib/peer-discovery.ts 의 로컬 .toml 스캔을 대체. 그건 패널이 Chang Mac 에서 직접
 *  돌 때만 됐고 NAS 컨테이너에선 늘 빈 배열이었다.) */
export type OrphanFavorite = {
  remoteId: string;
  favoritedBy: string[]; // 즐겨찾기한 직원 displayName 목록
  favoritedAt: Date; // 가장 최근 즐겨찾기 시각
  hostname: string | null; // 원격PC hostname (HQ 가 즐겨찾기할 때 동봉)
  alias: string | null; // 운영자 별칭 (예: "삼성공판장")
};

export async function listOrphanFavorites(
  tenantId: string,
): Promise<OrphanFavorite[]> {
  const rows = await db
    .select({
      remoteId: userFavorites.remoteId,
      displayName: users.displayName,
      favoritedAt: userFavorites.createdAt,
      hostname: userFavorites.hostname,
      alias: userFavorites.alias,
    })
    .from(userFavorites)
    .leftJoin(users, eq(users.id, userFavorites.userId))
    .where(
      and(eq(userFavorites.tenantId, tenantId), isNull(userFavorites.customerId)),
    )
    .orderBy(desc(userFavorites.createdAt));

  // 같은 머신을 여러 직원이 즐겨찾기했을 수 있어 remote_id 로 그룹핑.
  //   rows 가 createdAt desc 라 각 remote_id 의 첫 등장이 최신 = Map 삽입 순서가 곧 최신순.
  const byRemote = new Map<string, OrphanFavorite>();
  for (const r of rows) {
    const existing = byRemote.get(r.remoteId);
    if (existing) {
      if (r.displayName && !existing.favoritedBy.includes(r.displayName)) {
        existing.favoritedBy.push(r.displayName);
      }
      // 최신(첫 등장) 값이 우선이되, 비어 있으면 옛 행 값으로 backfill.
      if (!existing.hostname && r.hostname) existing.hostname = r.hostname;
      if (!existing.alias && r.alias) existing.alias = r.alias;
    } else {
      byRemote.set(r.remoteId, {
        remoteId: r.remoteId,
        favoritedBy: r.displayName ? [r.displayName] : [],
        favoritedAt: r.favoritedAt,
        hostname: r.hostname ?? null,
        alias: r.alias ?? null,
      });
    }
  }
  return [...byRemote.values()];
}

/** importPeer/createCustomer 가 remote_id 로 거래처를 만들 때, 같은 remote_id 의
 * orphan 즐겨찾기(customer_id NULL)를 새 customer 에 연결한다.
 * 그러면 "신규 거래처 후보" 배너에서 빠지고, 직원 즐겨찾기 탭엔 거래처 정보가 채워진다. */
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
