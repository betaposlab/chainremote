"use client";

// 자가등록(⑤ auto-enroll) 후보 확인 버튼. 거래처 표에서 enroll_status='pending' 행에만 표시.
// 클릭 → confirmEnrollment 서버액션 → 'active' 확정 → 일괄푸시/버전관리 대상 포함.
// cancelPushAction 버튼과 동일 패턴(useTransition + confirm).

import { useTransition } from "react";
import { confirmEnrollment } from "@/lib/actions/customers";

export function ConfirmEnrollButton({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (
          !confirm(
            `"${customerName}" 을(를) 정식 거래처로 확인합니다.\n(자동등록 후보 → 확정. 이후 일괄푸시/버전관리 대상에 포함)`,
          )
        )
          return;
        startTransition(async () => {
          await confirmEnrollment(customerId);
        });
      }}
      className="inline-flex items-center gap-1 rounded bg-emerald-50 text-emerald-700 text-xs px-2 py-1 hover:bg-emerald-100 disabled:opacity-50"
      title="자동등록 후보를 정식 거래처로 확정"
    >
      ✓ 확인
    </button>
  );
}
