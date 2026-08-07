// 대리점 문의함 데이터 레이어 (마이그 031).
//
// 격리 규칙은 하나다: 목록·상세는 언제나 tenantId 로 자르고, 전체를 보는 함수는 이름에
//   ForPlatform 을 달아 super_admin 전용임을 호출부에서 눈으로 구분되게 한다.
//   거래처/세션 쪽에서 "전체 조회 함수를 실수로 대리점 화면에 쓰는" 사고를 막으려고
//   쓰던 방식과 같다.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { feedback, tenants, users } from "@/lib/schema";

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

const MAX_TITLE = 120;
const MAX_BODY = 4000;
const MAX_REPLY = 4000;

/** 제출. 작성자 이름은 계정이 지워져도 남도록 스냅샷으로 박는다. */
export async function createFeedback(input: {
  tenantId: string;
  userId: string;
  authorName: string;
  kind: string;
  title: string;
  body: string;
}) {
  const kind = (FEEDBACK_KINDS as readonly string[]).includes(input.kind)
    ? (input.kind as FeedbackKind)
    : "suggestion";
  const title = input.title.trim().slice(0, MAX_TITLE);
  const body = input.body.trim().slice(0, MAX_BODY);
  if (!title) throw new Error("제목을 입력하세요.");
  if (!body) throw new Error("내용을 입력하세요.");

  const [row] = await db
    .insert(feedback)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      authorName: input.authorName.trim() || "(이름 없음)",
      kind,
      title,
      body,
    })
    .returning({ id: feedback.id });
  return row;
}

/** 대리점 화면 — 자기 회사 것만. */
export async function listFeedbackForTenant(tenantId: string) {
  return db
    .select({
      id: feedback.id,
      kind: feedback.kind,
      title: feedback.title,
      body: feedback.body,
      status: feedback.status,
      reply: feedback.reply,
      repliedAt: feedback.repliedAt,
      authorName: feedback.authorName,
      createdAt: feedback.createdAt,
    })
    .from(feedback)
    .where(eq(feedback.tenantId, tenantId))
    .orderBy(desc(feedback.createdAt));
}

/** 운영자 화면 — 전 대리점. ★super_admin 전용, 호출부에서 반드시 권한을 먼저 막을 것. */
export async function listFeedbackForPlatform() {
  return db
    .select({
      id: feedback.id,
      kind: feedback.kind,
      title: feedback.title,
      body: feedback.body,
      status: feedback.status,
      reply: feedback.reply,
      repliedAt: feedback.repliedAt,
      authorName: feedback.authorName,
      createdAt: feedback.createdAt,
      tenantName: tenants.displayName,
      authorEmail: users.email,
    })
    .from(feedback)
    .innerJoin(tenants, eq(feedback.tenantId, tenants.id))
    .leftJoin(users, eq(feedback.userId, users.id))
    // 미처리(open·reviewing)를 위로 — 운영자가 매번 정렬을 바꾸지 않게.
    .orderBy(
      sql`CASE ${feedback.status} WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END`,
      desc(feedback.createdAt),
    );
}

/** 상태·답변 갱신. ★super_admin 전용. */
export async function updateFeedbackStatus(
  id: number,
  input: { status?: string; reply?: string },
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (input.status !== undefined) {
    if (!(FEEDBACK_STATUSES as readonly string[]).includes(input.status)) {
      throw new Error("알 수 없는 상태입니다.");
    }
    patch.status = input.status;
  }
  if (input.reply !== undefined) {
    const reply = input.reply.trim().slice(0, MAX_REPLY);
    patch.reply = reply || null;
    // 답변을 지우면 답변 시각도 같이 지운다 — 남아 있으면 "답은 없는데 답한 날짜는 있는"
    //   상태가 되어 목록에서 처리된 것처럼 읽힌다.
    patch.repliedAt = reply ? new Date() : null;
  }

  const [row] = await db
    .update(feedback)
    .set(patch)
    .where(eq(feedback.id, id))
    .returning({ id: feedback.id, tenantId: feedback.tenantId });
  return row;
}

/** 미처리 건수 — 사이드바 배지용. super_admin 은 전체, 그 외는 자기 회사. */
export async function countOpenFeedback(tenantId: string | null) {
  const base = db
    .select({ n: sql<number>`count(*)::int` })
    .from(feedback);
  const rows = tenantId
    ? await base.where(and(eq(feedback.tenantId, tenantId), eq(feedback.status, "open")))
    : await base.where(eq(feedback.status, "open"));
  return rows[0]?.n ?? 0;
}
