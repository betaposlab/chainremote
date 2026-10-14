// VAN 데몬 재시작 카운터 초기화 + 이력(마이그 058). 배경은 마이그 파일 머리말.
//
// 포스를 교체하면 거래처 행은 이어지고 기기만 바뀐다. 그러면 옛 기기가 쌓은 재시작 숫자가
// 새 기기 옆에 그대로 붙어, 멀쩡한 새 포스가 "재시작 43" 으로 보인다. 숫자를 지우지 않고
// **접는다** — 그 전까지의 숫자는 한 행으로 보관하고 현재 칸만 0 에서 다시 센다.

import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerAlerts, customers, users, vanRestartResets } from "@/lib/schema";

export type VanResetResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "nothing" };

/**
 * 지금 숫자를 이력으로 접고 현재 칸을 0 으로. 자기 대리점 거래처만.
 * 셀 게 하나도 없으면(이미 0) 빈 행을 남기지 않는다 — 이력에 "0 → 0" 이 쌓이면 진짜 구간이 묻힌다.
 * 관제 on/off(van_watch)·현재 상태(van_ok·gave_up·missing)는 건드리지 않는다. 그건 지금 기기의 말이다.
 */
export async function resetVanCounters(input: {
  tenantId: string;
  customerId: string;
  userId: string | null;
  reason: string | null;
}): Promise<VanResetResult> {
  const reason = input.reason?.trim().slice(0, 200) || null;
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({
        id: customers.id,
        remoteId: customers.remoteId,
        vanWatch: customers.vanWatch,
        restartCount: customers.vanRestartCount,
        recoveredCount: customers.vanRecoveredCount,
        unrecoveredCount: customers.vanUnrecoveredCount,
        lastRestartAt: customers.vanLastRestartAt,
        resetAt: customers.vanResetAt,
      })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, input.tenantId)))
      .limit(1)
      .for("update");
    if (!c) return { ok: false, reason: "not_found" };
    if (
      c.restartCount === 0 &&
      c.recoveredCount === 0 &&
      c.unrecoveredCount === 0 &&
      !c.lastRestartAt
    ) {
      return { ok: false, reason: "nothing" };
    }
    // 숫자를 쌓은 기기 = **마지막 재시작 때** 붙어 있던 기기지, 지금 붙은 기기가 아니다.
    //   포스를 바꾼 뒤 초기화하는 게 이 기능의 쓰임새라, 초기화 당시 기기를 적으면 옛 기기의
    //   43회가 새 기기 이름표를 달고 남는다 — 2026-10-14 중앙리에서 실제로 그렇게 남아 고쳤다.
    //   마지막 재시작 뒤에 교체 알림(device_replaced)이 있으면 그 알림의 from 이 그 기기다.
    let deviceId = c.remoteId;
    if (c.lastRestartAt) {
      const [a] = await tx
        .select({ detail: customerAlerts.detail })
        .from(customerAlerts)
        .where(
          and(
            eq(customerAlerts.customerId, c.id),
            eq(customerAlerts.type, "device_replaced"),
            gt(customerAlerts.createdAt, c.lastRestartAt),
          ),
        )
        .orderBy(asc(customerAlerts.createdAt))
        .limit(1);
      if (a) {
        try {
          const d = JSON.parse(a.detail ?? "{}") as { from?: unknown };
          if (typeof d.from === "string" && d.from) deviceId = d.from;
        } catch {
          // 알림 본문이 깨졌으면 지금 기기로 둔다 — 없는 것보다 낫다.
        }
      }
    }
    const now = new Date();
    await tx.insert(vanRestartResets).values({
      tenantId: input.tenantId,
      customerId: c.id,
      remoteId: deviceId,
      vanKind: c.vanWatch,
      restartCount: c.restartCount,
      recoveredCount: c.recoveredCount,
      unrecoveredCount: c.unrecoveredCount,
      lastRestartAt: c.lastRestartAt,
      periodFrom: c.resetAt,
      resetAt: now,
      resetBy: input.userId,
      reason,
    });
    await tx
      .update(customers)
      .set({
        vanRestartCount: 0,
        vanRecoveredCount: 0,
        vanUnrecoveredCount: 0,
        vanLastRestartAt: null,
        vanResetAt: now,
      })
      .where(eq(customers.id, c.id));
    return { ok: true };
  });
}

export interface VanResetItem {
  resetAt: Date;
  periodFrom: Date | null;
  remoteId: string | null;
  vanKind: string | null;
  restartCount: number;
  recoveredCount: number;
  unrecoveredCount: number;
  lastRestartAt: Date | null;
  reason: string | null;
  by: string | null;
}

/** 한 거래처의 초기화 이력 — 최신순. tenantId 로 한 번 더 격리한다. */
export async function listVanResets(
  tenantId: string,
  customerId: string,
  limit = 20,
): Promise<VanResetItem[]> {
  return db
    .select({
      resetAt: vanRestartResets.resetAt,
      periodFrom: vanRestartResets.periodFrom,
      remoteId: vanRestartResets.remoteId,
      vanKind: vanRestartResets.vanKind,
      restartCount: vanRestartResets.restartCount,
      recoveredCount: vanRestartResets.recoveredCount,
      unrecoveredCount: vanRestartResets.unrecoveredCount,
      lastRestartAt: vanRestartResets.lastRestartAt,
      reason: vanRestartResets.reason,
      by: users.displayName,
    })
    .from(vanRestartResets)
    .leftJoin(users, eq(users.id, vanRestartResets.resetBy))
    .where(
      and(eq(vanRestartResets.tenantId, tenantId), eq(vanRestartResets.customerId, customerId)),
    )
    .orderBy(desc(vanRestartResets.resetAt))
    .limit(limit);
}
