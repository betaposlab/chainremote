// 문의함 상수·타입. ★DB 를 import 하지 않는다 — 클라이언트 컴포넌트가 쓰기 때문이다.
//
// 이 파일이 따로 있는 이유: 처음엔 lib/data/feedback.ts 에 같이 뒀는데, 거기는 @/lib/db 를
//   물고 있어서 "use client" 컴포넌트가 라벨 하나 가져다 쓰는 것만으로 pg 드라이버가 통째로
//   브라우저 번들에 끌려간다(Module not found: 'dns'). tsc 는 모듈 경계를 안 보므로 통과하고
//   next build 에서만 터진다. 클라이언트와 서버가 같이 쓰는 값은 여기 둔다.

export const FEEDBACK_KINDS = ["bug", "suggestion"] as const;
export const FEEDBACK_STATUSES = ["open", "reviewing", "done", "declined"] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const KIND_LABEL: Record<FeedbackKind, string> = {
  bug: "버그 신고",
  suggestion: "건의",
};

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: "접수",
  reviewing: "검토중",
  done: "반영",
  declined: "보류",
};
