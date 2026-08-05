"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteTenant,
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [downloading, setDownloading] = useState(false);
  const [resetResult, setResetResult] = useState<{
    adminEmail: string;
    tempPassword: string;
  } | null>(null);
  const [enrollResult, setEnrollResult] = useState<IssueEnrollKeyResult | null>(
    null,
  );

  // 이 대리점 전용 에이전트 .exe 다운로드 — 키 (재)발급 후 overlay 를 박아 내려준다.
  async function doDownload() {
    const warn = hasEnrollKey
      ? `'${displayName}' 전용 거래처 에이전트(.exe)를 다시 다운로드합니다.\n\n⚠️ 새 키가 발급되어, 이전에 받은 .exe 는 신규 거래처 등록이 안 됩니다.\n(이미 등록·설치된 거래처는 영향 없이 계속 작동)\n→ 이 새 .exe 를 대리점에 전달하세요.`
      : `'${displayName}' 전용 거래처 에이전트(.exe)를 다운로드합니다.\n\n이 .exe 로 깐 가맹점은 자동으로 '${displayName}' 소속으로 등록됩니다.\n이 파일을 이 대리점에 전달하세요.`;
    if (!confirm(warn)) return;
    setDownloading(true);
    try {
      const resp = await fetch(`/api/tenants/${tenantId}/agent`, {
        method: "POST",
      });
      if (!resp.ok) {
        let msg = "다운로드 실패";
        try {
          const j = await resp.json();
          msg = j.error ?? msg;
        } catch {}
        throw new Error(msg);
      }
      const blob = await resp.blob();
      // 파일명은 slug 랜덤문자열 대신 회사명 기반. 금지문자 제거 + 공백 압축 + 50자 캡으로
      //   NTFS 255/MAX_PATH 260 안에 안전하게 둔다(실제론 35자 내외).
      const safe =
        (displayName.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim() ||
          tenantId).slice(0, 50);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ChainRemote_${safe}_가맹점설치용.exe`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      router.refresh(); // 발급상태 배지 갱신
    } catch (e: any) {
      alert(e?.message ?? "다운로드 실패");
    } finally {
      setDownloading(false);
    }
  }

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

  // 회사 완전 삭제 — 파괴적(소속 사용자·거래처 전부). 이름 타이핑으로 오삭제 방지.
  function doDelete() {
    const typed = prompt(
      `⚠️ '${displayName}' 회사를 완전히 삭제합니다.\n` +
        `소속 사용자·거래처·즐겨찾기·지원기록이 모두 함께 삭제되며 되돌릴 수 없습니다.\n\n` +
        `삭제하려면 회사 이름을 정확히 입력하세요:`,
    );
    if (typed === null) return; // 취소
    if (typed.trim() !== displayName) {
      alert("이름이 일치하지 않아 취소했습니다.");
      return;
    }
    startTransition(async () => {
      const r = await deleteTenant(tenantId);
      if (!r.ok) {
        alert(r.error ?? "삭제 실패");
        return;
      }
      alert(
        `'${displayName}' 삭제 완료 (거래처 ${r.deletedCustomers ?? 0}개 포함).`,
      );
      router.refresh();
    });
  }

  return (
    <>
      <button
          type="button"
          onClick={doDownload}
          disabled={pending || downloading}
          title="이 대리점 전용 거래처 에이전트 설치파일(.exe) 다운로드 — 깐 가맹점이 이 대리점으로 자동 등록"
          className="btn btn-primary btn-sm"
        >
          {downloading ? "준비 중..." : "에이전트 다운로드"}
        </button>
      <button
          type="button"
          onClick={doIssueKey}
          disabled={pending || downloading}
          title="키/custom.txt 만 발급 (winpc 수동 빌드용 — 보통은 '에이전트 다운로드' 사용)"
          className="rounded border border-[#3d4c71] bg-[#1e2740] px-2 py-1 text-xs text-[#abaebb] hover:bg-white/[0.04] disabled:opacity-50"
        >
          {hasEnrollKey ? "키 재발급" : "키만"}
        </button>
      <button
          type="button"
          onClick={doReset}
          disabled={pending}
          className="rounded border border-[#3d4c71] bg-[#1e2740] px-2 py-1 text-xs hover:bg-white/[0.04] disabled:opacity-50"
        >
          비번 리셋
        </button>
        {status === "active" ? (
          <button
            type="button"
            onClick={() => doSuspend("suspended")}
            disabled={pending}
            className="rounded border border-amber-500/30 bg-[#1e2740] px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
          >
            일시정지
          </button>
        ) : status === "suspended" ? (
          <button
            type="button"
            onClick={() => doSuspend("active")}
            disabled={pending}
            className="rounded border border-green-300 bg-[#1e2740] px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
          >
            재개
          </button>
        ) : null}
        {status !== "cancelled" && (
          <button
            type="button"
            onClick={() => doSuspend("cancelled")}
            disabled={pending}
            className="rounded border border-[#3d4c71] bg-[#1e2740] px-2 py-1 text-xs text-[#abaebb] hover:bg-white/[0.04] disabled:opacity-50"
          >
            해지
          </button>
        )}
        <button
          type="button"
          onClick={doDelete}
          disabled={pending || downloading}
          title="이 회사와 소속 사용자·거래처를 완전 삭제 (되돌리기 불가)"
          className="rounded border border-[#ff6b6f]/30 bg-[#1e2740] px-2 py-1 text-xs text-[#ff9a9e] hover:bg-[#ff5a5f]/10 disabled:opacity-50"
        >
          회사 삭제
        </button>

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

// 에이전트 키 발급 결과 — reveal-once. 평문 키는 이 화면에서만 보인다.
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
        className="w-[560px] max-w-[94vw] rounded-lg bg-[#1e2740] p-6 shadow-xl text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">
          {result.tenantDisplayName} — 거래처 에이전트 키 {result.reissued ? "재발급" : "발급"} 완료
        </h2>

        {result.reissued && (
          <p className="mt-2 rounded-md bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-sm text-amber-200">
            ⚠️ 재발급되었습니다. <b>기존 키로 만든 인스톨러는 신규 거래처 등록이 안 됩니다.</b>{" "}
            (이미 등록된 거래처는 영향 없이 계속 작동) 이 대리점 에이전트를 아래 새 설정으로 다시 빌드하세요.
          </p>
        )}

        <p className="mt-3 text-sm text-[#9ba2b8]">
          아래 <code>custom.txt</code> 로 <b>이 대리점({result.slug}) 전용 에이전트</b>를
          빌드하세요. 이 설정이 박힌 .exe 로 깐 가맹점은 자동으로 이 대리점 소속으로 등록됩니다.
          <br />이 키는 <b>이 화면에서만</b> 보입니다 (DB 엔 해시만 저장 — 분실 시 재발급).
        </p>

        <div className="mt-3 text-xs font-medium text-[#9ba2b8]">enroll-key (평문)</div>
        <pre className="mt-1 whitespace-pre-wrap break-all rounded-md bg-[#14171f] border border-[#2c3852] px-3 py-2 text-xs font-mono text-[#d6d8de]">
{result.enrollKey}
        </pre>

        <div className="mt-3 text-xs font-medium text-[#9ba2b8]">custom.txt (빌드 입력값)</div>
        <pre className="mt-1 whitespace-pre-wrap break-all rounded-md bg-[#14171f] border border-[#2c3852] px-3 py-3 text-xs font-mono text-[#d6d8de]">
{result.customTxt}
        </pre>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => copy(result.enrollKey, "key")}
            className="rounded-md border border-[#3d4c71] bg-[#1e2740] px-3 py-2 text-sm hover:bg-white/[0.04]"
          >
            {copied === "key" ? "복사됨 ✓" : "키 복사"}
          </button>
          <button
            type="button"
            onClick={() => copy(result.customTxt, "txt")}
            className="rounded-md border border-[#3d4c71] bg-[#1e2740] px-3 py-2 text-sm hover:bg-white/[0.04]"
          >
            {copied === "txt" ? "복사됨 ✓" : "custom.txt 복사"}
          </button>
          <button
            type="button"
            onClick={download}
            className="btn btn-primary"
          >
            custom.txt 다운로드
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#3d4c71] bg-[#1e2740] px-4 py-2 text-sm hover:bg-white/[0.04]"
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
        className="w-[480px] max-w-[92vw] rounded-lg bg-[#1e2740] p-6 shadow-xl text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">비밀번호 재설정 완료</h2>
        <p className="mt-2 text-sm text-[#9ba2b8]">
          아래 임시 비밀번호를 카톡으로 전달하세요. 이 비번은 *이 화면에서만*
          확인 가능합니다 (DB 엔 hash 만 저장).
        </p>
        <pre className="mt-4 whitespace-pre-wrap break-all rounded-md bg-[#14171f] border border-[#2c3852] px-3 py-3 text-sm font-mono text-[#d6d8de]">
{message}
        </pre>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={copy}
            className="btn btn-primary"
          >
            카톡 메시지 복사
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#3d4c71] bg-[#1e2740] px-4 py-2 text-sm hover:bg-white/[0.04]"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
