"use server";

// VAN 데몬 재시작 카운터 초기화(마이그 058). 거래처 작업이라 직원 포함 전원이 한다 —
// 권한 기준은 기기 이관(lib/actions/alerts.ts)과 같다. 누가 언제 왜 되돌렸는지는
// van_restart_resets 행 자체에 남으므로 감사 로그에 또 적지 않는다.

import { revalidatePath } from "next/cache";
import { requireLiveUserOrThrow } from "@/lib/auth-guard";
import { canWrite } from "@/lib/roles";
import { resetVanCounters } from "@/lib/data/van-reset";

export async function resetVanCountersAction(
  customerId: string,
  reason: string,
): Promise<{ ok: boolean; reason?: string }> {
  const me = await requireLiveUserOrThrow();
  if (!canWrite(me.role)) {
    throw new Error("읽기 전용 계정은 이 작업 권한이 없습니다");
  }
  const r = await resetVanCounters({
    tenantId: me.tenantId,
    customerId,
    userId: me.id,
    reason,
  });
  if (!r.ok) {
    return {
      ok: false,
      reason: r.reason === "nothing" ? "되돌릴 숫자가 없습니다(이미 0)" : "거래처를 찾지 못했습니다",
    };
  }
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}/edit`);
  return { ok: true };
}
