"use client";

// 문의 삭제. 지우면 복구가 없어서 한 번 되묻는다 — 목록에서 버튼 하나로 사라지면
//   옆 줄을 누르는 사고가 난다.

import { useState, useTransition } from "react";
import { deleteFeedbackAction } from "@/lib/actions/feedback";

export function DeleteFeedbackButton({ id }: { id: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-text btn-danger-text"
        onClick={() => setConfirming(true)}
      >
        삭제
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-xs text-[#cbd1e0]">지우면 되돌릴 수 없습니다.</span>
      <form
        className="inline"
        action={(fd) => {
          setError(null);
          startTransition(async () => {
            try {
              await deleteFeedbackAction(fd);
            } catch (e) {
              setError(e instanceof Error ? e.message : "삭제에 실패했습니다.");
              setConfirming(false);
            }
          });
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button className="btn btn-sm btn-danger-text" disabled={pending}>
          {pending ? "지우는 중..." : "정말 삭제"}
        </button>
      </form>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => setConfirming(false)}
        disabled={pending}
      >
        취소
      </button>
      {error && <span className="text-xs text-[#ff6b6f]">{error}</span>}
    </span>
  );
}
