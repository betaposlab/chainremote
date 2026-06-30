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
  customerName: string;
  remoteId: string;
  lastHeartbeatAt: Date | null;
  activeSessionId: string | null;
  activeStartedAt: Date | null;
};

// 거래처가 오프라인으로 추정되면 사람이 읽는 "마지막 보고" 라벨, 온라인이면 null.
// heartbeat 10분 주기 → 살아있는 POS 는 보통 ≤10분. 살아있는데 잠깐 amber(10~12분)인 걸
// 헛경고하지 않도록 임계값을 주기보다 여유 있게 15분.
// 트레이드오프(의도): 거짓경고(살아있는 POS 경고)를 줄이는 쪽 우선 → 마지막 보고 후 15분 이내에
//   꺼진 기기는 경고 없이 시도될 수 있음. 그 경우 rustdesk:// 가 조용히 실패할 뿐 부작용 없음.
// (브라우저는 실제 연결 성공 여부를 알 수 없음 — heartbeat 가 유일한 오프라인 단서.)
function offlineWarning(lastHeartbeatAt: Date | null): string | null {
  if (!lastHeartbeatAt) return "보고 없음 (미보고)";
  const diffMin = Math.floor((Date.now() - new Date(lastHeartbeatAt).getTime()) / 60_000);
  if (diffMin < 15) return null; // 온라인(또는 방금까지 살아있던) → 경고 안 함
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}시간 전`;
  return `${Math.floor(diffMin / (60 * 24))}일 전`;
}

export function RemoteButton({
  customerId,
  customerName,
  remoteId,
  lastHeartbeatAt,
  activeSessionId,
  activeStartedAt,
}: Props) {
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
    // 오프라인(꺼져 있음) 추정 시 연결 전 경고 — heartbeat 가 stale/미보고면 원격이 안 될
    // 가능성이 높음. 끄진 PC 에 헛 세션+모달이 뜨던 문제 방지. 그래도 시도는 사용자 선택.
    const offlineLabel = offlineWarning(lastHeartbeatAt);
    if (
      offlineLabel &&
      !confirm(
        `⚠️ ${customerName} (${remoteId}) 은(는) 지금 오프라인으로 보입니다.\n` +
          `마지막 보고: ${offlineLabel}\n\n` +
          `원격이 안 될 수 있어요. 그래도 연결을 시도할까요?`,
      )
    ) {
      return; // 취소 → 세션 생성도 모달도 없음
    }
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
          customerName={customerName}
          remoteId={remoteId}
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
  customerName,
  remoteId,
  startedAt,
  onCancel,
  onComplete,
}: {
  sessionId: string;
  customerName: string;
  remoteId: string;
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
          {/* 어느 거래처를 원격했는지 — 딴짓하다 와도 한눈에. (거래처명 + RustDesk ID) */}
          <p className="text-sm font-medium text-slate-800 mt-1">
            {customerName}
            <span className="ml-1.5 font-mono text-xs text-slate-400">· {remoteId}</span>
          </p>
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
