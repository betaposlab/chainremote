"use client";

// 디스크 관제 칩(마이그 024) — heartbeat 로 보고된 C드라이브 여유공간을 경고 색으로 표시하고,
// 위험/주의 상태면 [정리] 버튼으로 원격 Temp+휴지통 정리를 큐잉한다(원격 접속 불필요).
// 에이전트는 다음 heartbeat(≤10분)에 명령을 받아 실행하고 결과를 보고한다.

import { useState, useTransition } from "react";
import { requestCleanupAction } from "@/lib/actions/customers";

function gb(bytes: number): string {
  const v = bytes / 1024 ** 3;
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

export function parseCleanupResult(json: string | null): {
  freedBytes?: number;
  deleted?: number;
  skipped?: number;
  at?: string;
  auto?: boolean;
} {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

export function DiskChip({
  remoteId,
  totalBytes,
  freeBytes,
  tempBytes,
  cleanupRequestedAt,
  cleanupResult,
}: {
  remoteId: string;
  totalBytes: number | null;
  freeBytes: number | null;
  tempBytes: number | null;
  cleanupRequestedAt: string | null; // ISO (serialize 경계 때문에 문자열)
  cleanupResult: string | null;
}) {
  const [pending, start] = useTransition();
  const [queued, setQueued] = useState(false);

  if (totalBytes == null || freeBytes == null || totalBytes <= 0) return null;

  // 위험/주의 판정 — 절대 GB 만 쓴다(2026-07-16 Chang 현장 데이터: 32/64GB C·D 분할
  // 포스가 많아 % 기준은 건강한 소용량 기기를 상시 경고로 만든다). 5GB 밑이면 에이전트가
  // 하루 1회 Temp 자동 정리도 돈다(휴지통은 수동 버튼만).
  const level =
    freeBytes < 5 * 1024 ** 3
      ? "red"
      : freeBytes < 8 * 1024 ** 3
        ? "amber"
        : "ok";

  const waiting = queued || !!cleanupRequestedAt;
  const result = parseCleanupResult(cleanupResult);

  const chipCls =
    level === "red"
      ? "bg-[#ff5a5f]/12 text-[#ffb3b6] font-medium"
      : level === "amber"
        ? "bg-amber-500/12 text-amber-300 font-medium"
        : "bg-white/[0.06] text-[#b9bfd2]";

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-block px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${chipCls}`}
        title={[
          `C: 여유 ${gb(freeBytes)}GB / 전체 ${gb(totalBytes)}GB`,
          tempBytes != null ? `Temp ${gb(tempBytes)}GB` : null,
          result.freedBytes != null
            ? `${result.auto ? "자동" : "마지막"} 정리 ${gb(result.freedBytes)}GB 확보 (${result.at?.slice(5, 10) ?? ""})`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        {level === "red" ? "🔴 " : level === "amber" ? "🟡 " : ""}
        여유 {gb(freeBytes)}GB
        {tempBytes != null && level !== "ok" ? ` · Temp ${gb(tempBytes)}GB` : ""}
      </span>
      {level !== "ok" &&
        (waiting ? (
          <span className="text-[10px] text-[#ccd2e3] whitespace-nowrap">
            정리 중…
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const ok = await requestCleanupAction(remoteId).catch(() => false);
                if (ok) setQueued(true);
              })
            }
            className="rounded border border-[#7485ae] bg-[#3d4e7a] hover:bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[#cbd1e0] disabled:opacity-50 whitespace-nowrap"
            title="원격 접속 없이 Temp(전 사용자+윈도우)와 휴지통을 영구삭제로 정리합니다. 다음 heartbeat(≤10분)에 실행 후 결과가 표시됩니다."
          >
            정리
          </button>
        ))}
    </span>
  );
}
