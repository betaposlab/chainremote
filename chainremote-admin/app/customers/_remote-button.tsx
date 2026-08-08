"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { endSession, discardSession } from "@/lib/actions/sessions";
import {
  ISSUE_TYPE_LABELS,
  RESOLUTION_LABELS,
  type IssueType,
  type Resolution,
} from "@/lib/session-labels";

type Props = {
  customerName: string;
  remoteId: string;
  lastHeartbeatAt: Date | null;
  activeSessionId: string | null;
  activeStartedAt: Date | null;
};

// 오프라인 추정 시 "마지막 보고" 라벨, 온라인이면 null.
// heartbeat 는 10분 주기라 살아있는 POS 는 보통 ≤10분. 잠깐 amber(10~12분)인 걸 헛경고하지
// 않도록 임계값을 주기보다 넉넉한 15분으로 뒀다. 즉 거짓경고를 줄이는 쪽으로 편향돼 있어,
// 마지막 보고 후 15분 안에 꺼진 기기는 경고 없이 시도될 수 있다 — rustdesk:// 가 조용히
// 실패할 뿐 부작용은 없다. (브라우저는 연결 성공 여부를 모르고 heartbeat 가 유일한 단서.)
function offlineWarning(lastHeartbeatAt: Date | null): string | null {
  if (!lastHeartbeatAt) return "보고 없음 (미보고)";
  const diffMin = Math.floor((Date.now() - new Date(lastHeartbeatAt).getTime()) / 60_000);
  if (diffMin < 15) return null; // 온라인(또는 방금까지 살아있던) → 경고 안 함
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}시간 전`;
  return `${Math.floor(diffMin / (60 * 24))}일 전`;
}

export function RemoteButton({
  customerName,
  remoteId,
  lastHeartbeatAt,
  activeSessionId,
  activeStartedAt,
}: Props) {
  const router = useRouter();

  // 기록은 이제 HQ 가 원격 연결 시 자동으로 남긴다(단일 기록자 = HQ). 패널 버튼은 세션을
  // 만들지 않고 앱만 띄운다("띄우기만"). 활성 세션(HQ 가 만든 것)이 있으면 여기서 조회하고,
  // 필요하면 종료 모달로 수동 종료(폴백)만 한다.
  const isActive = !!activeSessionId;

  // 로드 시 활성 세션(HQ 가 만든 것)이 있으면 종료 모달을 바로 연다.
  const [modalOpen, setModalOpen] = useState(!!activeSessionId);

  const onConnect = () => {
    // heartbeat 가 stale/미보고면 원격이 안 될 확률이 높으니 연결 전에 경고한다.
    const offlineLabel = offlineWarning(lastHeartbeatAt);
    if (
      offlineLabel &&
      !confirm(
        `⚠️ ${customerName} (${remoteId}) 은(는) 지금 오프라인으로 보입니다.\n` +
          `마지막 보고: ${offlineLabel}\n\n` +
          `원격이 안 될 수 있어요. 그래도 연결을 시도할까요?`,
      )
    ) {
      return;
    }
    // 폰·태블릿에서는 먼저 사정을 알린다.
    //   이 버튼은 rustdesk:// 딥링크로 PC 의 ChainRemote 앱을 띄우는 것뿐이라, 앱이 없는
    //   기기에서는 눌러도 아무 일이 안 일어난다 — 사용자에겐 "버튼이 고장 났다"로 읽힌다.
    //   모바일 HQ 는 아직 배포 경로가 없으므로 그 사실을 그대로 말한다.
    //   확인을 누르면 시도는 한다 — 앱을 따로 깔아 둔 기기에서는 실제로 열리기 때문이다.
    //   기준을 화면 폭으로 잡은 건 표를 카드로 눕히는 CSS 와 같은 경계를 쓰기 위해서다.
    const isNarrow =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches;
    if (
      isNarrow &&
      !confirm(
        "원격 접속은 PC 에 설치된 ChainRemote 앱으로 연결됩니다.\n" +
          "휴대폰에는 앱이 없어 아무 일도 일어나지 않을 수 있습니다.\n\n" +
          "그래도 시도할까요?",
      )
    ) {
      return;
    }
    // 기록은 HQ 가 남긴다 — 패널은 rustdesk 딥링크로 앱만 띄운다.
    window.location.href = `rustdesk://${remoteId}`;
  };

  // "나중에" — 모달만 닫고 세션은 계속 진행.
  const onCancel = () => setModalOpen(false);

  // 저장/폐기 후 — 모달 닫고 서버 데이터 재조회.
  const onComplete = () => {
    setModalOpen(false);
    router.refresh();
  };

  return (
    <>
      {isActive ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1 rounded-md bg-[#d64550] hover:bg-[#e35560] text-white px-3 py-1.5 text-xs font-medium animate-pulse"
          title="지원 기록을 마감합니다. 원격 연결은 HQ 창을 닫아야 끊깁니다."
        >
          🔴 지원 중 · 기록 마감
        </button>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          className="inline-flex items-center gap-1 rounded-md btn btn-primary px-3 py-1.5 text-xs font-medium"
        >
          🖥️ 원격접속
        </button>
      )}

      {modalOpen && activeSessionId && (
        <EndSessionModal
          sessionId={activeSessionId}
          customerName={customerName}
          remoteId={remoteId}
          startedAt={activeStartedAt}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#02040a]/70 p-4">
      <div className="w-full max-w-md rounded-xl bg-[#3d4e7a] border border-[#7485ae] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
        <header className="border-b border-[#566999] px-5 py-3">
          <h2 className="font-semibold text-white">지원 기록 마감</h2>
          {/* 패널은 hbbs 세션을 끊을 통로가 없다 — 여기서 닫히는 건 기록뿐이다. 버튼이
              '종료'라고만 되어 있던 때는 눌러도 원격이 안 끊겨 혼란을 샀다. */}
          <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded px-2 py-1 mt-1.5">
            기록만 마감합니다. <strong>원격 연결은 끊기지 않습니다</strong> — 끊으려면 HQ
            원격 창을 닫으세요.
          </p>
          {/* 어느 거래처를 원격했는지 — 딴짓하다 와도 한눈에. (거래처명 + RustDesk ID) */}
          <p className="text-sm font-medium text-white mt-1">
            {customerName}
            <span className="ml-1.5 font-mono text-xs text-[#ccd2e3]">· {remoteId}</span>
          </p>
          {startedAt && (
            <p className="text-xs text-[#b9bfd2] mt-0.5">
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
            <span className="block text-sm font-medium text-[#eef1f7] mb-1">장애 유형</span>
            <select name="issueType" defaultValue="other" className="input">
              {(Object.keys(ISSUE_TYPE_LABELS) as IssueType[]).map((k) => (
                <option key={k} value={k}>
                  {ISSUE_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-[#eef1f7] mb-1">해결 여부</span>
            <select name="resolution" defaultValue="resolved" className="input">
              {(["resolved", "pending", "escalated"] as Resolution[]).map((k) => (
                <option key={k} value={k}>
                  {RESOLUTION_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-[#eef1f7] mb-1">지원 내용</span>
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
                if (
                  !confirm(
                    "이 지원 기록을 폐기할까요? (실수로 시작했을 때만)\n\n" +
                      "기록만 지워지고 원격 연결은 그대로 유지됩니다.",
                  )
                )
                  return;
                start(async () => {
                  await discardSession(sessionId);
                  onComplete();
                });
              }}
              disabled={pending}
              className="text-xs text-[#ccd2e3] hover:text-[#ff9a9e] underline"
            >
              기록 폐기
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="btn btn-ghost"
              >
                나중에
              </button>
              <button
                type="submit"
                disabled={pending}
                className="btn btn-primary"
              >
                {pending ? "저장 중..." : "기록 저장"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
