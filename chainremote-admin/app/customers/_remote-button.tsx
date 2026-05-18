"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startSession, endSession, discardSession } from "@/lib/actions/sessions";
import {
  ISSUE_TYPE_LABELS,
  RESOLUTION_LABELS,
  type IssueType,
  type Resolution,
} from "@/lib/session-labels";

type Props = {
  customerId: string;
  remoteId: string;
  activeSessionId: string | null;
  activeStartedAt: Date | null;
};

export function RemoteButton({ customerId, remoteId, activeSessionId, activeStartedAt }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // 서버(DB)에서 온 활성 세션 + 클라이언트에서 방금 시작한 세션의 오버레이.
  // 서버 → 클라이언트 → 서버 의 race 를 피하기 위해 양쪽 합쳐서 판단.
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const [localStartedAt, setLocalStartedAt] = useState<Date | null>(null);
  const effectiveSessionId = activeSessionId ?? localSessionId;
  const effectiveStartedAt = activeStartedAt ?? localStartedAt;
  const isActive = !!effectiveSessionId;

  // 모달은 활성 세션 있을 때만 의미 있음. 페이지 로드 시 활성 세션 있으면 자동 오픈.
  const [modalOpen, setModalOpen] = useState(!!activeSessionId);

  const onConnect = () => {
    start(async () => {
      const sid = await startSession(customerId);
      window.location.href = `rustdesk://${remoteId}`;
      setLocalSessionId(sid);
      setLocalStartedAt(new Date());
      setModalOpen(true);
      router.refresh();
    });
  };

  // "나중에" — 모달만 닫음, 세션은 그대로 진행 중.
  const onCancel = () => setModalOpen(false);

  // 저장/폐기 후 — 활성 세션 클리어 + 모달 닫음 + 서버 데이터 재조회.
  const onComplete = () => {
    setLocalSessionId(null);
    setLocalStartedAt(null);
    setModalOpen(false);
    router.refresh();
  };

  return (
    <>
      {isActive ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1 rounded-md bg-rose-500 hover:bg-rose-600 text-white px-3 py-1.5 text-xs font-medium animate-pulse"
        >
          🔴 진행 중 · 종료
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md bg-[#00A0E5] hover:bg-[#0090d0] disabled:opacity-50 text-white px-3 py-1.5 text-xs font-medium"
        >
          {pending ? "연결 중..." : "🖥️ 원격접속"}
        </button>
      )}

      {modalOpen && effectiveSessionId && (
        <EndSessionModal
          sessionId={effectiveSessionId}
          startedAt={effectiveStartedAt}
          onCancel={onCancel}
          onComplete={onComplete}
        />
      )}
    </>
  );
}

function EndSessionModal({
  sessionId,
  startedAt,
  onCancel,
  onComplete,
}: {
  sessionId: string;
  startedAt: Date | null;
  onCancel: () => void;
  onComplete: () => void;
}) {
  const [pending, start] = useTransition();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <header className="border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold text-slate-900">지원 종료 + 기록 저장</h2>
          {startedAt && (
            <p className="text-xs text-slate-500 mt-0.5">
              시작: {new Date(startedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
            </p>
          )}
        </header>
        <form
          action={(fd) =>
            start(async () => {
              await endSession(sessionId, fd);
              onComplete();
            })
          }
          className="px-5 py-4 space-y-3"
        >
          <label className="block">
            <span className="block text-sm font-medium text-slate-700 mb-1">장애 유형</span>
            <select name="issueType" defaultValue="other" className="input">
              {(Object.keys(ISSUE_TYPE_LABELS) as IssueType[]).map((k) => (
                <option key={k} value={k}>
                  {ISSUE_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-slate-700 mb-1">해결 여부</span>
            <select name="resolution" defaultValue="resolved" className="input">
              {(["resolved", "pending", "escalated"] as Resolution[]).map((k) => (
                <option key={k} value={k}>
                  {RESOLUTION_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-slate-700 mb-1">지원 내용</span>
            <textarea
              name="description"
              rows={4}
              placeholder="POS 영수증 프린터 IP 재설정 / 윈도우 업데이트 후 드라이버 재설치"
              className="input"
            />
          </label>
          <div className="flex items-center justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                if (!confirm("이 세션 기록을 폐기할까요? (실수로 시작했을 때만)")) return;
                start(async () => {
                  await discardSession(sessionId);
                  onComplete();
                });
              }}
              disabled={pending}
              className="text-xs text-slate-400 hover:text-rose-600 underline"
            >
              기록 폐기
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-slate-200 hover:bg-slate-50 px-4 py-2 text-sm"
              >
                나중에
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-[#00A0E5] hover:bg-[#0090d0] disabled:opacity-50 text-white px-4 py-2 text-sm font-medium"
              >
                {pending ? "저장 중..." : "저장 + 종료"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
