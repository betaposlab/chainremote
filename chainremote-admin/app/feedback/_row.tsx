"use client";

// 문의 한 건 — 접힌 요약 줄 + 펼친 본문.
//
// 카드로 전부 펼쳐 두면 문의가 몇 건만 쌓여도 훑을 수가 없다. 긴 본문과 답변이 화면을
//   가득 채워 "무엇이 와 있나"를 파악하는 데 스크롤이 필요해진다.
//   접힌 줄에는 판단에 필요한 것만 남긴다: 유형·상태·제목·작성자·시각, 그리고 첨부/답변 유무.
//
// ★접힌 내용은 브라우저 Ctrl+F 로 못 찾는다. 지금은 제목이 줄에 보이므로 대개 충분하지만,
//   건수가 늘면 검색을 붙여야 한다(지원기록 화면이 이미 그 길을 갔다).

import { useState } from "react";
import { KIND_LABEL, STATUS_LABEL, type FeedbackKind, type FeedbackStatus } from "@/lib/feedback-constants";
import { AdminRowControls } from "./_admin-row";
import { DeleteFeedbackButton } from "./_delete-button";

function statusChipClass(status: string) {
  return status === "done"
    ? "chip chip-ok"
    : status === "declined"
      ? "chip chip-neutral"
      : status === "reviewing"
        ? "chip chip-accent"
        : "chip chip-warn";
}

export interface FeedbackRowData {
  id: number;
  kind: string;
  title: string;
  body: string;
  status: string;
  reply: string | null;
  repliedAt: string | null;
  authorName: string;
  hadImages: boolean;
  createdAt: string;
  tenantName?: string | null;
  images: { id: number; originalName: string }[];
}

export function FeedbackRow({
  row,
  isPlatform,
  canDelete,
}: {
  row: FeedbackRowData;
  isPlatform: boolean;
  /** 대리점은 아직 답이 안 나간 자기 글만 지울 수 있다. 판정은 서버가 다시 한다. */
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <article className="panel-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-white/[0.04] transition-colors"
      >
        <span className="text-xs text-[#cbd1e0]">{open ? "▾" : "▸"}</span>
        <span className="chip chip-neutral shrink-0">
          {KIND_LABEL[row.kind as FeedbackKind] ?? row.kind}
        </span>
        <span className={`${statusChipClass(row.status)} shrink-0`}>
          {STATUS_LABEL[row.status as FeedbackStatus] ?? row.status}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-white">{row.title}</span>

        {/* 펼치지 않고도 알아야 할 것 — 첨부가 있나, 답이 나갔나 */}
        {(row.images.length > 0 || row.hadImages) && (
          <span className="shrink-0 text-xs text-[#cbd1e0]" title="첨부 이미지">
            📎{row.images.length > 0 ? row.images.length : ""}
          </span>
        )}
        {row.reply && (
          <span className="chip chip-accent shrink-0" title="답변 완료">
            답변
          </span>
        )}

        <span className="hidden shrink-0 text-xs text-[#cbd1e0] sm:inline">
          {row.tenantName ? `${row.tenantName} · ` : ""}
          {row.authorName} · {row.createdAt}
        </span>
      </button>

      {open && (
        <div className="border-t border-[#51638f] p-4 pt-3">
          {/* 좁은 화면에선 요약 줄에서 감췄던 작성자·시각을 여기서 보여준다 */}
          <div className="mb-2 text-xs text-[#cbd1e0] sm:hidden">
            {row.tenantName ? `${row.tenantName} · ` : ""}
            {row.authorName} · {row.createdAt}
          </div>

          <p className="whitespace-pre-wrap text-sm text-[#eef1f7]">{row.body}</p>

          {row.images.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {row.images.map((im) => (
                <a
                  key={im.id}
                  href={`/api/feedback/image/${im.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block h-28 w-28 overflow-hidden rounded-lg border border-[#566999]"
                  title={`${im.originalName} — 새 탭에서 크게 보기`}
                >
                  {/* 인증 라우트라 next/image 최적화 대상이 아니다. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/feedback/image/${im.id}`}
                    alt={im.originalName}
                    className="h-full w-full object-cover"
                  />
                </a>
              ))}
            </div>
          ) : row.hadImages ? (
            <div className="mt-3 text-xs text-[#cbd1e0]">
              첨부 이미지는 보관 기간이 지나 삭제되었습니다. (글과 답변은 그대로 보관됩니다)
            </div>
          ) : null}

          {row.reply && (
            <div className="mt-3 rounded-lg border border-[#4c7dff]/40 bg-[#4c7dff]/10 p-3">
              <div className="text-xs font-semibold text-[#c3d3ff]">
                베타포스랩 답변 {row.repliedAt ? `· ${row.repliedAt}` : ""}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[#eef1f7]">{row.reply}</p>
            </div>
          )}

          {isPlatform ? (
            <>
              <AdminRowControls id={row.id} status={row.status} reply={row.reply} />
              <div className="mt-2">
                <DeleteFeedbackButton id={row.id} />
              </div>
            </>
          ) : (
            canDelete && (
              <div className="mt-3 border-t border-[#51638f] pt-2">
                <DeleteFeedbackButton id={row.id} />
              </div>
            )
          )}
        </div>
      )}
    </article>
  );
}
