"use client";

// 문의 목록 + 검색·필터.
//
// 서버 왕복 없이 클라이언트에서 거른다. 문의는 대리점 50곳 기준으로도 월 100건 남짓이라
//   전부 받아 두고 훑는 편이 빠르고 코드도 단순하다(거래처 화면이 같은 방식).
//
// ★검색은 접힌 본문·답변까지 훑는다. 접이식으로 바꾸면서 브라우저 Ctrl+F 가 못 닿는
//   영역이 생겼는데, 그걸 메우는 게 이 검색의 존재 이유다. 그래서 본문에 걸린 건은
//   자동으로 펼친다 — 안 그러면 "왜 이게 걸렸지?" 가 된다.

import { useMemo, useState } from "react";
import { FEEDBACK_STATUSES, STATUS_LABEL, type FeedbackStatus } from "@/lib/feedback-constants";
import { FeedbackRow, type FeedbackRowData } from "./_row";

export function FeedbackList({
  data,
  isPlatform,
}: {
  data: FeedbackRowData[];
  isPlatform: boolean;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | FeedbackStatus>("all");

  const query = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    return data.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!query) return true;
      const hay = [r.title, r.body, r.reply ?? "", r.authorName, r.tenantName ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });
  }, [data, query, status]);

  // 상태칩에 건수를 같이 보여준다 — 눌러 보기 전에 뭐가 얼마나 있는지 알 수 있다.
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: data.length };
    for (const s of FEEDBACK_STATUSES) m[s] = 0;
    for (const r of data) m[r.status] = (m[r.status] ?? 0) + 1;
    return m;
  }, [data]);

  return (
    <>
      <div className="mb-4 space-y-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="제목 · 내용 · 답변 · 작성자로 검색"
          className="input w-full"
          aria-label="문의 검색"
        />
        <div className="flex flex-wrap gap-1.5">
          {(["all", ...FEEDBACK_STATUSES] as const).map((s) => {
            const active = status === s;
            const n = counts[s] ?? 0;
            // 건수 0 인 상태는 굳이 안 보인다. 'all' 과 현재 선택은 항상 남긴다.
            if (s !== "all" && n === 0 && !active) return null;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`chip ${active ? "chip-accent" : "chip-neutral"}`}
                aria-pressed={active}
              >
                {s === "all" ? "전체" : STATUS_LABEL[s]} {n}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="panel-card p-8 text-center text-sm text-[#cbd1e0]">
          {data.length === 0
            ? isPlatform
              ? "아직 들어온 문의가 없습니다."
              : "아직 보낸 문의가 없습니다. 위 버튼으로 첫 문의를 남겨 보세요."
            : "조건에 맞는 문의가 없습니다."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            // 제목 줄만 봐서는 왜 걸렸는지 모르는 경우 — 본문이나 답변에 걸린 건 펼쳐서 보여준다.
            const inBody =
              !!query &&
              `${r.body} ${r.reply ?? ""}`.toLowerCase().includes(query) &&
              !r.title.toLowerCase().includes(query);
            return (
              <FeedbackRow
                // 검색어가 바뀌면 리마운트해 펼침 상태를 다시 계산한다.
                key={`${r.id}-${inBody ? "open" : "shut"}`}
                row={r}
                isPlatform={isPlatform}
                canDelete={r.status === "open" && !r.reply}
                defaultOpen={inBody}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
