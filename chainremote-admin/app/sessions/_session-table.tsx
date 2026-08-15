"use client";

// 지원기록 표 — 행을 누르면 그 아래로 전문이 펼쳐진다.
//   종전엔 내용을 한 줄에서 CSS 로 잘라(truncate) 긴 기록은 읽을 방법이 아예 없었다.
//   기록의 존재 이유가 "무엇을 해줬는지 나중에 읽는 것" 이라 잘리면 기능이 없는 셈이다(2026-07-31 Chang).
//   목록은 훑는 화면, 펼침은 읽는 화면으로 역할을 나눴다. HQ 의 카드형 이력과 같은 정보를 보여준다.

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORY_LABELS,
  ISSUE_TYPE_LABELS,
  RESOLUTION_LABELS,
  type IssueType,
  type Resolution,
} from "@/lib/session-labels";
import { updateSession, restoreSession, discardSession } from "@/lib/actions/sessions";
import { RecordFields } from "./_record-fields";

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
  /** 폐기 시각(마이그045). 있으면 폐기된 기록 — "폐기 포함"으로만 목록에 나온다. */
  discardedAt: string | null;
  /** 원격 없이 손으로 남긴 기록(마이그045). */
  manual: boolean;
};

export function SessionTable({ rows }: { rows: SessionRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function saveEdit(id: string, fd: FormData) {
    start(async () => {
      await updateSession(id, fd);
      setEditId(null);
      router.refresh();
    });
  }

  return (
    <div className="panel-table-wrap">
      <table className="panel-table">
        <thead>
          <tr>
            <th className="text-left px-4 py-3 font-medium">거래처</th>
            <th className="text-left px-4 py-3 font-medium">시작</th>
            <th className="text-left px-4 py-3 font-medium hidden md:table-cell">소요</th>
            <th className="text-left px-4 py-3 font-medium hidden md:table-cell">담당</th>
            <th className="text-left px-4 py-3 font-medium hidden md:table-cell">장애 유형</th>
            <th className="text-left px-4 py-3 font-medium">해결</th>
            <th className="text-left px-4 py-3 font-medium hidden md:table-cell">내용</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ongoing = !r.endedAt;
            // 미기록 = 끝났는데 A/S 내용(설명·종류)을 아무것도 안 적은 것(바빠서 [닫기]만).
            const unlogged = !ongoing && !r.description?.trim() && !r.categories?.trim();
            // 끝난 세션의 "진행 중"은 거짓말이다 — 해결 여부를 아무도 안 고른 것뿐이다.
            //   자동 마감된 고아 세션(HQ 가 죽어 종료 보고를 못 한 것)이 정확히 이 모습이라
            //   그대로 두면 "아직 원격 중"으로 읽힌다. 비워서 미기록임이 드러나게 한다.
            const resolution = ongoing
              ? r.resolution
              : r.resolution === "in_progress"
                ? null
                : r.resolution;
            const open = openId === r.id;
            const cats = (r.categories ?? "")
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean);

            return (
              // key 는 Fragment 에 — map 의 자식이 이것이다. 안쪽 <tr> 에 달면 React 가
              //   목록을 못 맞춰(경고 발생) 새로고침 뒤 펼침·편집 상태가 엉뚱한 행에 붙는다.
              <Fragment key={r.id}>
                <tr
                  onClick={() => setOpenId(open ? null : r.id)}
                  className="cursor-pointer"
                  style={open ? {background:"rgba(255,255,255,.035)"} : undefined}
                >
                  <td className="px-4 py-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={`text-[#7d84a0] transition-transform ${open ? "rotate-90" : ""}`}
                        aria-hidden
                      >
                        ▸
                      </span>
                      {r.customerName ?? <span className="text-[#ccd2e3]">(삭제됨)</span>}
                      {r.discardedAt && (
                        <span
                          className="inline-block rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[#b9bfd2] line-through"
                          title="폐기된 기록 — 접속 사실은 남아 있습니다"
                        >
                          폐기
                        </span>
                      )}
                      {r.manual && (
                        <span
                          className="inline-block rounded bg-[#4C7DFF]/15 px-1.5 py-0.5 text-[10px] text-[#C3D3FF]"
                          title="원격 없이 손으로 남긴 기록"
                        >
                          수동
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#cbd1e0] whitespace-nowrap">
                    {formatDate(r.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-[#cbd1e0] tabular-nums hidden md:table-cell">
                    {ongoing ? (
                      <span className="inline-block chip chip-danger animate-pulse">
                        진행 중
                      </span>
                    ) : (
                      formatDuration(r.durationSec)
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#cbd1e0] whitespace-nowrap hidden md:table-cell">
                    {r.operatorName ?? <span className="text-[#7d84a0]">-</span>}
                  </td>
                  <td className="px-4 py-3 text-[#cbd1e0] hidden md:table-cell">
                    {r.issueType ? ISSUE_TYPE_LABELS[r.issueType] : "-"}
                  </td>
                  <td className="px-4 py-3 text-[#cbd1e0]">
                    {resolution ? (
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${
                          resolution === "resolved"
                            ? "chip chip-ok"
                            : resolution === "in_progress"
                              ? "bg-amber-500/12 text-amber-300"
                              : "bg-white/[0.06] text-[#eef1f7]"
                        }`}
                      >
                        {RESOLUTION_LABELS[resolution]}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  {/* 두 줄까지 보여주고, 그래도 길면 펼쳐서 읽는다. */}
                  <td className="px-4 py-3 text-[#b9bfd2] text-xs max-w-[52ch] hidden md:table-cell">
                    {unlogged ? (
                      <span className="inline-block bg-white/[0.06] text-[#ccd2e3] px-2 py-0.5 rounded">
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
                      <div className="rounded-lg border border-[#566999] bg-[#313c58] p-4 space-y-3">
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
                            <span className="text-xs text-[#ccd2e3] mr-1">A/S 종류</span>
                            {cats.map((c) => (
                              <span
                                key={c}
                                className="inline-block bg-white/[0.06] text-[#cbd1e0] px-2 py-0.5 rounded text-xs"
                              >
                                {CATEGORY_LABELS[c] ?? c}
                              </span>
                            ))}
                          </div>
                        )}

                        {editId === r.id ? (
                          <form
                            action={(fd) => saveEdit(r.id, fd)}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded-md border border-[#566999] bg-[#2b364f] p-3"
                          >
                            <RecordFields
                              defaults={{
                                issueType: r.issueType,
                                resolution: resolution,
                                contactName: r.contactName,
                                categories: r.categories,
                                description: r.description,
                              }}
                            />
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditId(null)}
                                className="btn btn-ghost"
                                disabled={pending}
                              >
                                취소
                              </button>
                              <button type="submit" className="btn btn-primary" disabled={pending}>
                                {pending ? "저장 중…" : "저장"}
                              </button>
                            </div>
                          </form>
                        ) : (
                          <div>
                            <div className="text-xs text-[#ccd2e3] mb-1">내용</div>
                            {r.description?.trim() ? (
                              <p className="text-sm text-[#eef1f7] whitespace-pre-wrap leading-relaxed">
                                {r.description}
                              </p>
                            ) : (
                              <p className="text-sm text-[#ccd2e3]">
                                {ongoing
                                  ? "원격이 진행 중입니다. 종료하면서 기록할 수 있습니다."
                                  : "기록된 내용이 없습니다. [기록 편집]으로 지금 채울 수 있습니다."}
                              </p>
                            )}
                          </div>
                        )}

                        {/* 행 동작 — 편집은 언제든(끝났든 미기록이든 폐기됐든), 폐기/복원은 토글. */}
                        {editId !== r.id && (
                          <div
                            className="flex items-center justify-between gap-2 pt-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="text-[11px] text-[#8b93ab]">
                              {r.discardedAt
                                ? `폐기됨 · ${formatDateFull(r.discardedAt)} — 접속 사실은 남아 있습니다`
                                : r.manual
                                  ? "수동 기록 — 원격 세션이 아닙니다"
                                  : ""}
                            </div>
                            <div className="flex items-center gap-2">
                              {r.discardedAt ? (
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() =>
                                    start(async () => {
                                      await restoreSession(r.id);
                                      router.refresh();
                                    })
                                  }
                                  className="text-xs text-[#ccd2e3] underline hover:text-white"
                                >
                                  폐기 취소
                                </button>
                              ) : (
                                !ongoing && (
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() => {
                                      if (
                                        !confirm(
                                          "이 기록을 폐기할까요?\n\n" +
                                            "목록에서 숨겨질 뿐 지워지지 않습니다 — 접속 사실은 남고, " +
                                            "'폐기 포함'으로 다시 볼 수 있습니다.",
                                        )
                                      )
                                        return;
                                      start(async () => {
                                        await discardSession(r.id);
                                        router.refresh();
                                      });
                                    }}
                                    className="text-xs text-[#ccd2e3] underline hover:text-[#ff9a9e]"
                                  >
                                    기록 폐기
                                  </button>
                                )
                              )}
                              {!ongoing && (
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => setEditId(r.id)}
                                  className="btn btn-ghost !py-1 !px-2.5 text-xs"
                                >
                                  기록 편집
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="px-4 py-12 text-center text-[#ccd2e3] text-sm">
          해당 조건의 지원기록이 없습니다.
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[#ccd2e3]">{label}</dt>
      <dd className="text-[#eef1f7] mt-0.5">{value?.trim() ? value : "-"}</dd>
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
