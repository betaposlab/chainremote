"use client";

// VAN 데몬 재시작 기록 카드(마이그 058) — 지금 숫자 + [카운터 초기화] + 접어 둔 이력.
//
// 포스를 바꾸면 거래처 행은 그대로라 옛 기기의 재시작 숫자가 새 기기 옆에 붙는다(중앙리 43회).
// 여기서 숫자를 0 에서 다시 세게 하되, 그 전까지의 숫자는 아래 이력으로 남긴다.
// 관제를 켠 적 없는 거래처(기록도 없음)는 카드 자체를 그리지 않는다.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetVanCountersAction } from "@/lib/actions/van";

export interface VanResetHistoryRow {
  resetAt: string; // ISO (serialize 경계)
  periodFrom: string | null;
  remoteId: string | null;
  vanLabel: string;
  restartCount: number;
  recoveredCount: number;
  unrecoveredCount: number;
  lastRestartAt: string | null;
  reason: string | null;
  by: string | null;
}

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";
const fmtDay = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "numeric",
        day: "numeric",
      })
    : "";

function outcome(recovered: number, unrecovered: number): string {
  const n = recovered + unrecovered;
  return n === 0 ? "성패 관측 전" : `복구 ${recovered} · 미복구 ${unrecovered}`;
}

export function VanResetCard({
  customerId,
  customerName,
  vanLabel,
  watching,
  current,
  history,
  canWrite,
}: {
  customerId: string;
  customerName: string;
  vanLabel: string;
  watching: boolean;
  current: {
    restartCount: number;
    recoveredCount: number;
    unrecoveredCount: number;
    lastRestartAt: string | null;
    reportedAt: string | null;
    resetAt: string | null;
  };
  history: VanResetHistoryRow[];
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("포스 교체");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!watching && history.length === 0) return null;

  const hasNumbers =
    current.restartCount > 0 || current.recoveredCount > 0 || current.unrecoveredCount > 0;

  function submit() {
    setErr(null);
    start(async () => {
      const r = await resetVanCountersAction(customerId, reason);
      if (!r.ok) {
        setErr(r.reason ?? "되돌리지 못했습니다");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="mt-6 rounded-xl border border-[#566999] bg-white/[0.02] p-5">
      <h2 className="text-sm font-semibold text-[#eef1f7]">
        {vanLabel || "VAN"} 데몬 재시작 기록
      </h2>

      {watching ? (
        <p className="mt-1 text-xs text-[#cbd1e0]">
          {current.restartCount > 0 ? (
            <>
              재시작 시도 <b>{current.restartCount}</b>회 ·{" "}
              {outcome(current.recoveredCount, current.unrecoveredCount)}
              {current.lastRestartAt ? ` · 마지막 ${fmt(current.lastRestartAt)}` : ""}
            </>
          ) : (
            <>재시작 시도 없음{current.resetAt ? ` (${fmtDay(current.resetAt)} 초기화 이후)` : ""}</>
          )}
        </p>
      ) : (
        <p className="mt-1 text-xs text-[#9aa3ba]">지금은 관제가 꺼져 있습니다. 아래는 지난 기록입니다.</p>
      )}
      {watching ? (
        <p className="mt-1 text-xs text-[#9aa3ba]">
          {current.reportedAt
            ? `에이전트가 마지막으로 데몬 상태를 알려온 시각 ${fmt(current.reportedAt)}`
            : "에이전트가 데몬 상태를 알려온 기록이 아직 없습니다(패널 갱신 뒤 다음 보고부터 쌓입니다)"}
        </p>
      ) : null}

      {canWrite && watching && hasNumbers ? (
        !open ? (
          <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost mt-3 text-xs">
            카운터 초기화
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-[#9aa3ba]">
              지금 숫자는 아래 이력에 남고, 현재 칸만 0 에서 다시 셉니다. 포스를 바꿨거나 원인을 고친 뒤
              새로 세고 싶을 때 쓰세요.
            </p>
            <label className="block">
              <span className="block text-xs text-[#ccd2e3] mb-1">사유 (이력에 남습니다)</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="input"
                maxLength={200}
                autoComplete="off"
              />
            </label>
            {err && <p className="text-xs text-[#ff9a9e]">{err}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (
                    !confirm(
                      `“${customerName}” 의 재시작 ${current.restartCount}회(${outcome(
                        current.recoveredCount,
                        current.unrecoveredCount,
                      )})를 이력으로 접고 0 부터 다시 셉니다.`,
                    )
                  )
                    return;
                  submit();
                }}
                className="btn btn-primary text-xs"
              >
                {pending ? "되돌리는 중…" : "초기화"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setErr(null);
                }}
                className="btn btn-ghost text-xs"
                disabled={pending}
              >
                취소
              </button>
            </div>
          </div>
        )
      ) : null}

      {history.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-[#ccd2e3]">지난 구간</h3>
          <ul className="mt-2 space-y-1.5 text-xs">
            {history.map((h, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-28 shrink-0 tabular-nums text-[#9aa3ba]">
                  {h.periodFrom ? `${fmtDay(h.periodFrom)} ~ ` : "~ "}
                  {fmtDay(h.resetAt)}
                </span>
                <span className="text-[#cbd1e0]">
                  재시작 <b>{h.restartCount}</b>회 · {outcome(h.recoveredCount, h.unrecoveredCount)}
                  {h.lastRestartAt ? ` · 마지막 ${fmt(h.lastRestartAt)}` : ""}
                  {h.remoteId ? ` · 기기 ${h.remoteId}` : ""}
                  {h.vanLabel ? ` · ${h.vanLabel}` : ""}
                  <span className="text-[#9aa3ba]">
                    {" "}
                    — {fmt(h.resetAt)} {h.by ? `${h.by} ` : ""}초기화{h.reason ? ` (${h.reason})` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
