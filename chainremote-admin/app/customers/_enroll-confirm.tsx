"use client";

// auto-enroll 후보 확인 버튼 — enroll_status='pending' 행에만 뜬다. 클릭하면
// confirmEnrollment 로 'active' 확정, 이후 일괄푸시/버전관리 대상에 든다.
// cancelPushAction 버튼과 같은 useTransition + confirm 패턴.

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
      className="inline-flex items-center gap-1 rounded chip chip-ok btn-sm disabled:opacity-50 hover:brightness-125"
      title="자동등록 후보를 정식 거래처로 확정"
    >
      ✓ 확인
    </button>
  );
}
