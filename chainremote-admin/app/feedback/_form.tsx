"use client";

// 문의 작성 폼. 평소엔 접혀 있고 버튼으로 편다 — 목록을 보러 온 사람이 대부분이라
//   폼이 항상 펼쳐져 있으면 정작 답변 확인이 아래로 밀린다.

import { useState, useTransition } from "react";
import { submitFeedbackAction } from "@/lib/actions/feedback";

export function FeedbackForm() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        + 새 문의 보내기
      </button>
    );
  }

  return (
    <form
      className="panel-card p-4 space-y-3"
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          try {
            await submitFeedbackAction(fd);
            setOpen(false);
          } catch (e) {
            setError(e instanceof Error ? e.message : "전송에 실패했습니다.");
          }
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-[#cbd1e0]">유형</label>
        <select name="kind" className="input w-40" defaultValue="suggestion">
          <option value="suggestion">건의</option>
          <option value="bug">버그 신고</option>
        </select>
      </div>

      <input
        name="title"
        className="input w-full"
        placeholder="제목 — 한 줄로 요약해 주세요"
        maxLength={120}
        required
      />
      <textarea
        name="body"
        className="input w-full min-h-[9rem]"
        placeholder={
          "버그라면 어떤 상황에서 생겼는지, 건의라면 어떤 일을 하려다 불편했는지 적어 주시면 가장 도움이 됩니다.\n" +
          "거래처 상호나 화면 이름을 같이 적어 주시면 재현이 훨씬 빨라집니다."
        }
        maxLength={4000}
        required
      />

      {error && <div className="banner banner-danger">{error}</div>}

      <div className="flex items-center gap-2">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "보내는 중..." : "보내기"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
        >
          취소
        </button>
      </div>
    </form>
  );
}
