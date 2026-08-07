"use client";

// 운영자(super_admin)용 처리 UI. 상태 변경과 답변을 한 자리에서.
//   대리점 화면에는 이 컴포넌트가 아예 렌더되지 않는다 — 권한은 서버 액션이 다시 막지만,
//   보이지 않는 편이 오조작 자체를 줄인다.

import { useState, useTransition } from "react";
import { updateFeedbackAction } from "@/lib/actions/feedback";
import { STATUS_LABEL, type FeedbackStatus } from "@/lib/feedback-constants";

const STATUSES: FeedbackStatus[] = ["open", "reviewing", "done", "declined"];

export function AdminRowControls({
  id,
  status,
  reply,
}: {
  id: number;
  status: string;
  reply: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fd: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await updateFeedbackAction(fd);
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "처리에 실패했습니다.");
      }
    });
  };

  return (
    <div className="mt-3 border-t border-[#51638f] pt-3 space-y-2">
      <form className="flex flex-wrap items-center gap-2" action={run}>
        <input type="hidden" name="id" value={id} />
        <span className="text-xs text-[#cbd1e0]">상태</span>
        <select name="status" defaultValue={status} className="input w-32">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button className="btn btn-sm" disabled={pending}>
          상태 저장
        </button>
        {!editing && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setEditing(true)}
          >
            {reply ? "답변 수정" : "답변 달기"}
          </button>
        )}
      </form>

      {editing && (
        <form className="space-y-2" action={run}>
          <input type="hidden" name="id" value={id} />
          <textarea
            name="reply"
            className="input w-full min-h-[6rem]"
            defaultValue={reply ?? ""}
            placeholder="대리점에 보일 답변입니다. 비우고 저장하면 답변이 지워집니다."
            maxLength={4000}
          />
          <div className="flex gap-2">
            <button className="btn btn-sm btn-primary" disabled={pending}>
              {pending ? "저장 중..." : "답변 저장"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              취소
            </button>
          </div>
        </form>
      )}

      {error && <div className="banner banner-danger">{error}</div>}
    </div>
  );
}
