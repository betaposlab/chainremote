"use client";

// 지원기록 표 — 행을 누르면 그 아래로 전문이 펼쳐진다.
//   종전엔 내용을 한 줄에서 CSS 로 잘라(truncate) 긴 기록은 읽을 방법이 아예 없었다.
//   기록의 존재 이유가 "무엇을 해줬는지 나중에 읽는 것" 이라 잘리면 기능이 없는 셈이다(2026-07-31 Chang).
//   목록은 훑는 화면, 펼침은 읽는 화면으로 역할을 나눴다. HQ 의 카드형 이력과 같은 정보를 보여준다.

import { useState } from "react";
import {
  CATEGORY_LABELS,
  ISSUE_TYPE_LABELS,
  RESOLUTION_LABELS,
  type IssueType,
  type Resolution,
} from "@/lib/session-labels";

export type SessionRow = {
  id: string;
  customerName: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  issueType: IssueType | null;
  resolution: Resolution | null;
  description: string | null;
  categories: string | null;
  contactName: string | null;
  operatorName: string | null;
  remoteId: string | null;
};

export function SessionTable({ rows }: { rows: SessionRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="panel-table-wrap">
      <table className="panel-table">
        <thead>
          <tr>
            <th className="text-left px-4 py-3 font-medium">거래처</th>
            <th className="text-left px-4 py-3 font-medium">시작</th>
            <th className="text-left px-4 py-3 font-medium">소요</th>
            <th className="text-left px-4 py-3 font-medium">담당</th>
            <th className="text-left px-4 py-3 font-medium">장애 유형</th>
            <th className="text-left px-4 py-3 font-medium">해결</th>
            <th className="text-left px-4 py-3 font-medium">내용</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ongoing = !r.endedAt;
            // 미기록 = 끝났는데 A/S 내용(설명·종류)을 아무것도 안 적은 것(바빠서 [닫기]만).
            const unlogged = !ongoing && !r.description?.trim() && !r.categories?.trim();
            const open = openId === r.id;
            const cats = (r.categories ?? "")
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean);

            return (
              <>
                <tr
                  key={r.id}
                  onClick={() => setOpenId(open ? null : r.id)}
                  className="cursor-pointer"
                  style={open ? {background:"rgba(255,255,255,.035)"} : undefined}
                >
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={`text-[#4b5370] transition-transform ${open ? "rotate-90" : ""}`}
                        aria-hidden
                      >
                        ▸
                      </span>
                      {r.customerName ?? <span className="text-[#6b7390]">(삭제됨)</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#abaebb] whitespace-nowrap">
                    {formatDate(r.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-[#abaebb] tabular-nums">
                    {ongoing ? (
                      <span className="inline-block chip chip-danger animate-pulse">
                        진행 중
                      </span>
                    ) : (
                      formatDuration(r.durationSec)
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#abaebb] whitespace-nowrap">
                    {r.operatorName ?? <span className="text-[#4b5370]">-</span>}
                  </td>
                  <td className="px-4 py-3 text-[#abaebb]">
                    {r.issueType ? ISSUE_TYPE_LABELS[r.issueType] : "-"}
                  </td>
                  <td className="px-4 py-3 text-[#abaebb]">
                    {r.resolution ? (
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${
                          r.resolution === "resolved"
                            ? "chip chip-ok"
                            : r.resolution === "in_progress"
                              ? "bg-amber-500/12 text-amber-300"
                              : "bg-white/[0.06] text-[#c7c9d1]"
                        }`}
                      >
                        {RESOLUTION_LABELS[r.resolution]}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  {/* 두 줄까지 보여주고, 그래도 길면 펼쳐서 읽는다. */}
                  <td className="px-4 py-3 text-[#8a93ad] text-xs max-w-[52ch]">
                    {unlogged ? (
                      <span className="inline-block bg-white/[0.06] text-[#6b7390] px-2 py-0.5 rounded">
                        미기록
                      </span>
                    ) : (
                      <span className="line-clamp-2 whitespace-pre-wrap">
                        {r.description ?? ""}
                      </span>
                    )}
                  </td>
                </tr>

                {open && (
                  <tr key={`${r.id}-detail`} className="bg-white/[0.02]">
                    <td colSpan={7} className="px-4 pb-5 pt-1">
                      <div className="rounded-lg border border-[#172540] bg-[#0e111b] p-4 space-y-3">
                        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                          <Field label="시작" value={formatDateFull(r.startedAt)} />
                          <Field
                            label="종료"
                            value={ongoing ? "진행 중" : formatDateFull(r.endedAt)}
                          />
                          <Field label="담당 직원" value={r.operatorName} />
                          <Field label="거래처 응대자" value={r.contactName} />
                          <Field label="원격 ID" value={r.remoteId} />
                        </dl>

                        {cats.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-[#6b7390] mr-1">A/S 종류</span>
                            {cats.map((c) => (
                              <span
                                key={c}
                                className="inline-block bg-white/[0.06] text-[#abaebb] px-2 py-0.5 rounded text-xs"
                              >
                                {CATEGORY_LABELS[c] ?? c}
                              </span>
                            ))}
                          </div>
                        )}

                        <div>
                          <div className="text-xs text-[#6b7390] mb-1">내용</div>
                          {r.description?.trim() ? (
                            <p className="text-sm text-[#c7c9d1] whitespace-pre-wrap leading-relaxed">
                              {r.description}
                            </p>
                          ) : (
                            <p className="text-sm text-[#6b7390]">
                              {ongoing
                                ? "원격이 진행 중입니다. 종료하면서 기록할 수 있습니다."
                                : "기록된 내용이 없습니다. 본사 앱의 지원기록에서 채울 수 있습니다."}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="px-4 py-12 text-center text-[#6b7390] text-sm">
          해당 조건의 지원기록이 없습니다.
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[#6b7390]">{label}</dt>
      <dd className="text-[#c7c9d1] mt-0.5">{value?.trim() ? value : "-"}</dd>
    </div>
  );
}

function formatDate(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateFull(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "-";
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${m % 60}분`;
}
