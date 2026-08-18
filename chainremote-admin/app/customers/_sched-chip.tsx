"use client";

// 예약원격 창 칩(마이그 048) — 거래처가 승인한 "수락 없이 들어와도 되는" 구간이 지금 열려
// 있을 때만 표시하고, [닫기] 로 그 허용을 거둔다.
//
// ★창의 진실은 거래처 PC 의 마커 파일이고 여기 값은 에이전트가 heartbeat 로 알려 준 사본이다.
//   그래서 꺼져 있는 PC 는 마지막 보고 시점의 값이 남는다 — 종료 시각이 지났으면 아무것도
//   그리지 않는다(그 PC 는 켜지는 순간 스스로 닫는다).
// ★[닫기] 는 큐잉이지 즉시 실행이 아니다. 패널에서 에이전트로 가는 실시간 통로가 없어
//   다음 heartbeat(≤10분)에 실려 내려간다. 그래서 눌러도 칩이 바로 사라지지 않는다 —
//   거래처가 "닫혔다"고 보고해야 사라진다. 꺼진 PC 에서 명령이 증발하고도 성공처럼 보이면
//   안 되기 때문에 일부러 이렇게 뒀다.

import { useState, useTransition } from "react";
import { requestSchedCloseAction } from "@/lib/actions/customers";

/** "오후 11시" / "8/19 오전 3시" — 오늘이 아니면 날짜를 붙인다. */
function fmtUntil(until: Date): string {
  const h = until.getHours();
  const m = until.getMinutes();
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const time = `${ampm} ${h12}시${m ? ` ${m}분` : ""}`;
  const today = new Date();
  const sameDay =
    until.getFullYear() === today.getFullYear() &&
    until.getMonth() === today.getMonth() &&
    until.getDate() === today.getDate();
  return sameDay
    ? time
    : `${until.getMonth() + 1}/${until.getDate()} ${time}`;
}

export function SchedChip({
  remoteId,
  openUntil,
  closeRequestedAt,
}: {
  remoteId: string;
  openUntil: string | null; // ISO (serialize 경계)
  closeRequestedAt: string | null;
}) {
  const [pending, start] = useTransition();
  const [queued, setQueued] = useState(false);

  if (!openUntil) return null;
  const until = new Date(openUntil);
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return null;

  const waiting = queued || !!closeRequestedAt;

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap bg-amber-500/12 text-amber-300 font-medium"
        title={[
          `원격 예약 중 — ${fmtUntil(until)}까지`,
          "이 구간에는 수락 창이 뜨지 않고 바로 접속됩니다.",
          "거래처가 직접 승인한 구간입니다(트레이에서 취소도 가능).",
        ].join(" · ")}
      >
        ⏱ 원격 예약 {fmtUntil(until)}까지
      </span>
      {waiting ? (
        <span
          className="text-[10px] text-[#ccd2e3] whitespace-nowrap"
          title="다음 heartbeat(≤10분)에 전달됩니다. 거래처가 닫혔다고 보고하면 사라집니다."
        >
          닫는 중…
        </span>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const ok = await requestSchedCloseAction(remoteId).catch(
                () => false,
              );
              if (ok) setQueued(true);
            })
          }
          className="rounded border border-[#7485ae] bg-[#3d4e7a] hover:bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[#cbd1e0] disabled:opacity-50 whitespace-nowrap"
          title="원격 예약을 거둡니다. 다음 heartbeat(≤10분)에 전달되며, 거래처가 실제로 닫았다고 보고해야 표시가 사라집니다."
        >
          닫기
        </button>
      )}
    </span>
  );
}
