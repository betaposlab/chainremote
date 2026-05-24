"use client";

import { useState, useTransition } from "react";
import {
  resetTenantOwnerPassword,
  setSubscriptionStatus,
} from "@/lib/actions/tenants";

type Props = {
  tenantId: string;
  displayName: string;
  status: "active" | "suspended" | "cancelled";
};

export function TenantRowActions({ tenantId, displayName, status }: Props) {
  const [pending, startTransition] = useTransition();
  const [resetResult, setResetResult] = useState<{
    adminEmail: string;
    tempPassword: string;
  } | null>(null);

  function doReset() {
    if (!confirm(`'${displayName}' 의 관리자 비밀번호를 재설정하시겠습니까?`))
      return;
    startTransition(async () => {
      try {
        const r = await resetTenantOwnerPassword(tenantId);
        setResetResult(r);
      } catch (e: any) {
        alert(e?.message ?? "재설정 실패");
      }
    });
  }

  function doSuspend(next: "active" | "suspended" | "cancelled") {
    const labelMap = { active: "재개", suspended: "정지", cancelled: "해지" };
    if (!confirm(`'${displayName}' 를 ${labelMap[next]} 하시겠습니까?`)) return;
    startTransition(async () => {
      try {
        await setSubscriptionStatus(tenantId, next);
      } catch (e: any) {
        alert(e?.message ?? "처리 실패");
      }
    });
  }

  return (
    <>
      <button
          type="button"
          onClick={doReset}
          disabled={pending}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          비번 리셋
        </button>
        {status === "active" ? (
          <button
            type="button"
            onClick={() => doSuspend("suspended")}
            disabled={pending}
            className="rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
          >
            일시정지
          </button>
        ) : status === "suspended" ? (
          <button
            type="button"
            onClick={() => doSuspend("active")}
            disabled={pending}
            className="rounded border border-green-300 bg-white px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
          >
            재개
          </button>
        ) : null}
        {status !== "cancelled" && (
          <button
            type="button"
            onClick={() => doSuspend("cancelled")}
            disabled={pending}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            해지
          </button>
        )}

      {resetResult && (
        <ResetResultDialog
          adminEmail={resetResult.adminEmail}
          tempPassword={resetResult.tempPassword}
          tenantDisplayName={displayName}
          onClose={() => setResetResult(null)}
        />
      )}
    </>
  );
}

function ResetResultDialog({
  adminEmail,
  tempPassword,
  tenantDisplayName,
  onClose,
}: {
  adminEmail: string;
  tempPassword: string;
  tenantDisplayName: string;
  onClose: () => void;
}) {
  const message = `[ChainRemote] ${tenantDisplayName} 임시 비밀번호 안내\n\n아이디: ${adminEmail}\n임시 비밀번호: ${tempPassword}\n\n로그인 후 앱에서 비밀번호를 변경해주세요.`;

  function copy() {
    void navigator.clipboard.writeText(message);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-w-[92vw] rounded-lg bg-white p-6 shadow-xl text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">비밀번호 재설정 완료</h2>
        <p className="mt-2 text-sm text-slate-500">
          아래 임시 비밀번호를 카톡으로 전달하세요. 이 비번은 *이 화면에서만*
          확인 가능합니다 (DB 엔 hash 만 저장).
        </p>
        <pre className="mt-4 whitespace-pre-wrap break-all rounded-md bg-slate-50 px-3 py-3 text-sm font-mono">
{message}
        </pre>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-md bg-[#00A0E5] px-4 py-2 text-sm font-medium text-white hover:bg-[#0086c2]"
          >
            카톡 메시지 복사
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
