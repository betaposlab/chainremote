// 거래처 알림 데이터 레이어 — enroll "상호 = 교체 키" 매트릭스의 사람 결정 큐.
// 미해결 알림 조회 + 마스터 처리 액션([이동]/[개명]/[무시]). tenantId 격리 강제.

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerAlerts, customers, userFavorites } from "@/lib/schema";

export type AlertDetail = {
  remoteId?: string;
  currentName?: string;
  newName?: string;
  name?: string;
  from?: string | null;
  to?: string;
  reason?: string;
};

export function parseAlertDetail(detail: string | null): AlertDetail {
  try {
    return detail ? (JSON.parse(detail) as AlertDetail) : {};
  } catch {
    return {};
  }
}

/** 미해결 알림 + 대상 거래처명. 최신순. */
export async function listOpenAlerts(tenantId: string) {
  return db
    .select({ alert: customerAlerts, customerName: customers.name })
    .from(customerAlerts)
    .leftJoin(customers, eq(customers.id, customerAlerts.customerId))
    .where(
      and(eq(customerAlerts.tenantId, tenantId), isNull(customerAlerts.resolvedAt)),
    )
    .orderBy(desc(customerAlerts.createdAt));
}

async function getOpenAlert(id: string, tenantId: string) {
  const [a] = await db
    .select()
    .from(customerAlerts)
    .where(
      and(
        eq(customerAlerts.id, id),
        eq(customerAlerts.tenantId, tenantId),
        isNull(customerAlerts.resolvedAt),
      ),
    )
    .limit(1);
  return a;
}

/** [무시] — 알림만 해결 처리, 데이터 무변경. */
export async function resolveAlert(id: string, tenantId: string): Promise<boolean> {
  const a = await getOpenAlert(id, tenantId);
  if (!a) return false;
  await db
    .update(customerAlerts)
    .set({ resolvedAt: new Date() })
    .where(eq(customerAlerts.id, id));
  return true;
}

/** [상호만 변경] — reinstalled_new_name 알림의 새 상호를 그 거래처 이름으로 반영.
 *  (설치 때 친 이름이 사실 개명 의도였던 경우 — 예: 간판 바꾼 매장.) */
export async function applyAlertRename(id: string, tenantId: string): Promise<boolean> {
  const a = await getOpenAlert(id, tenantId);
  if (!a || a.type !== "reinstalled_new_name" || !a.customerId) return false;
  const d = parseAlertDetail(a.detail);
  if (!d.newName?.trim()) return false;
  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({ name: d.newName!.trim(), updatedAt: new Date() })
      .where(and(eq(customers.id, a.customerId!), eq(customers.tenantId, tenantId)));
    await tx
      .update(customerAlerts)
      .set({ resolvedAt: new Date() })
      .where(eq(customerAlerts.id, id));
  });
  return true;
}

/** [새 거래처로 이동] — reinstalled_new_name 알림의 기기를 새 상호의 신규 거래처로 옮긴다.
 *  옛 거래처 행은 기기만 떼고 보존(이력 유지). 토큰을 승계해 기기 무중단.
 *  즐겨찾기는 기기를 따라가되 소속 거래처를 갱신. */
export async function applyAlertMoveToNew(id: string, tenantId: string): Promise<boolean> {
  const a = await getOpenAlert(id, tenantId);
  if (!a || a.type !== "reinstalled_new_name" || !a.customerId) return false;
  const d = parseAlertDetail(a.detail);
  if (!d.newName?.trim() || !d.remoteId) return false;

  const [src] = await db
    .select({
      id: customers.id,
      name: customers.name,
      remoteId: customers.remoteId,
      heartbeatToken: customers.heartbeatToken,
    })
    .from(customers)
    .where(and(eq(customers.id, a.customerId), eq(customers.tenantId, tenantId)))
    .limit(1);
  // 알림 생성 후 기기가 이미 딴 데로 갔으면(스테일) 데이터 조작 없이 실패 반환.
  if (!src || src.remoteId !== d.remoteId) return false;

  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({ remoteId: null, heartbeatToken: null })
      .where(eq(customers.id, src.id));
    const [dst] = await tx
      .insert(customers)
      .values({
        tenantId,
        name: d.newName!.trim(),
        remoteId: d.remoteId!,
        enrollStatus: "active",
        heartbeatToken: src.heartbeatToken, // 토큰 승계 — 기기 재enroll 없이 즉시 계속
      })
      .returning({ id: customers.id });
    await tx
      .update(userFavorites)
      .set({ customerId: dst.id })
      .where(
        and(
          eq(userFavorites.remoteId, d.remoteId!),
          eq(userFavorites.tenantId, tenantId),
        ),
      );
    await tx
      .update(customerAlerts)
      .set({ resolvedAt: new Date() })
      .where(eq(customerAlerts.id, id));
    await tx.insert(customerAlerts).values({
      tenantId,
      customerId: dst.id,
      type: "device_moved",
      detail: JSON.stringify({ remoteId: d.remoteId, from: src.name, to: d.newName }),
      resolvedAt: new Date(), // 감사 로그
    });
  });
  return true;
}
