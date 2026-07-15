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

  // 위험/주의 판정 — 포스 SSD 는 60~128GB 라 %보다 절대 GB 병행 (이중 기준).
  const ratio = freeBytes / totalBytes;
  const level =
    freeBytes < 5 * 1024 ** 3 || ratio < 0.08
      ? "red"
      : freeBytes < 10 * 1024 ** 3 || ratio < 0.2
        ? "amber"
        : "ok";

  const waiting = queued || !!cleanupRequestedAt;
  const result = parseCleanupResult(cleanupResult);

  const chipCls =
    level === "red"
      ? "bg-rose-100 text-rose-700 font-medium"
      : level === "amber"
        ? "bg-amber-100 text-amber-700 font-medium"
        : "bg-slate-100 text-slate-500";

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-block px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${chipCls}`}
        title={[
          `C: 여유 ${gb(freeBytes)}GB / 전체 ${gb(totalBytes)}GB`,
          tempBytes != null ? `Temp ${gb(tempBytes)}GB` : null,
          result.freedBytes != null
            ? `마지막 정리 ${gb(result.freedBytes)}GB 확보 (${result.at?.slice(5, 10) ?? ""})`
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
          <span className="text-[10px] text-slate-400 whitespace-nowrap">
            정리 대기 중…
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
            className="rounded border border-slate-300 bg-white hover:bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 disabled:opacity-50 whitespace-nowrap"
            title="원격 접속 없이 Temp(전 사용자+윈도우)와 휴지통을 영구삭제로 정리합니다. 다음 heartbeat(≤10분)에 실행 후 결과가 표시됩니다."
          >
            정리
          </button>
        ))}
    </span>
  );
}
