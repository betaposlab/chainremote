"use client";

import { useState, useTransition } from "react";
import {
  issueTenantEnrollKey,
  resetTenantOwnerPassword,
  setSubscriptionStatus,
  type IssueEnrollKeyResult,
} from "@/lib/actions/tenants";

type Props = {
  tenantId: string;
  displayName: string;
  status: "active" | "suspended" | "cancelled";
  hasEnrollKey: boolean;
};

export function TenantRowActions({
  tenantId,
  displayName,
  status,
  hasEnrollKey,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [resetResult, setResetResult] = useState<{
    adminEmail: string;
    tempPassword: string;
  } | null>(null);
  const [enrollResult, setEnrollResult] = useState<IssueEnrollKeyResult | null>(
    null,
  );

  function doIssueKey() {
    const warn = hasEnrollKey
      ? `'${displayName}' 의 에이전트 키를 *재발급* 하시겠습니까?\n\n⚠️ 기존 키로 만든 인스톨러는 신규 거래처 등록이 안 됩니다.\n(이미 등록된 거래처는 영향 없음 — 계속 작동)\n재발급하면 이 대리점 에이전트를 새 키로 다시 빌드해야 합니다.`
      : `'${displayName}' 의 거래처 에이전트 키를 발급하시겠습니까?\n\n이 키로 이 대리점 전용 에이전트를 빌드하면, 그 에이전트로 깐 가맹점은 자동으로 이 대리점 소속으로 등록됩니다.`;
    if (!confirm(warn)) return;
    startTransition(async () => {
      try {
        const r = await issueTenantEnrollKey(tenantId);
        setEnrollResult(r);
      } catch (e: any) {
        alert(e?.message ?? "키 발급 실패");
      }
    });
  }

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
          onClick={doIssueKey}
          disabled={pending}
          title="이 대리점 전용 거래처 에이전트 키 발급 (자가등록용)"
          className={`rounded border px-2 py-1 text-xs disabled:opacity-50 ${
            hasEnrollKey
              ? "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              : "border-[#00A0E5] bg-[#00A0E5] text-white hover:bg-[#0086c2]"
          }`}
        >
          {hasEnrollKey ? "에이전트 키 재발급" : "에이전트 키 발급"}
        </button>
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

      {enrollResult && (
        <EnrollKeyDialog
          result={enrollResult}
          onClose={() => setEnrollResult(null)}
        />
      )}
    </>
  );
}

// ⑤ 에이전트 키 발급 결과 — reveal-once. 평문 키는 *이 화면에서만* 보임.
function EnrollKeyDialog({
  result,
  onClose,
}: {
  result: IssueEnrollKeyResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"" | "txt" | "key">("");

  function copy(text: string, which: "txt" | "key") {
    void navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(""), 1500);
  }

  function download() {
    const blob = new Blob([result.customTxt], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `custom-agent-${result.slug}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[94vw] rounded-lg bg-white p-6 shadow-xl text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">
          {result.tenantDisplayName} — 거래처 에이전트 키 {result.reissued ? "재발급" : "발급"} 완료
        </h2>

        {result.reissued && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⚠️ 재발급되었습니다. <b>기존 키로 만든 인스톨러는 신규 거래처 등록이 안 됩니다.</b>{" "}
            (이미 등록된 거래처는 영향 없이 계속 작동) 이 대리점 에이전트를 아래 새 설정으로 다시 빌드하세요.
          </p>
        )}

        <p className="mt-3 text-sm text-slate-500">
          아래 <code>custom.txt</code> 로 <b>이 대리점({result.slug}) 전용 에이전트</b>를
          빌드하세요. 이 설정이 박힌 .exe 로 깐 가맹점은 자동으로 이 대리점 소속으로 등록됩니다.
          <br />이 키는 <b>이 화면에서만</b> 보입니다 (DB 엔 해시만 저장 — 분실 시 재발급).
        </p>

        <div className="mt-3 text-xs font-medium text-slate-500">enroll-key (평문)</div>
        <pre className="mt-1 whitespace-pre-wrap break-all rounded-md bg-slate-50 px-3 py-2 text-xs font-mono">
{result.enrollKey}
        </pre>

        <div className="mt-3 text-xs font-medium text-slate-500">custom.txt (빌드 입력값)</div>
        <pre className="mt-1 whitespace-pre-wrap break-all rounded-md bg-slate-50 px-3 py-3 text-xs font-mono">
{result.customTxt}
        </pre>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => copy(result.enrollKey, "key")}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            {copied === "key" ? "복사됨 ✓" : "키 복사"}
          </button>
          <button
            type="button"
            onClick={() => copy(result.customTxt, "txt")}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            {copied === "txt" ? "복사됨 ✓" : "custom.txt 복사"}
          </button>
          <button
            type="button"
            onClick={download}
            className="rounded-md bg-[#00A0E5] px-4 py-2 text-sm font-medium text-white hover:bg-[#0086c2]"
          >
            custom.txt 다운로드
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
