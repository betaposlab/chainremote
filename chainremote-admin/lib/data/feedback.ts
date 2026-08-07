// 대리점 문의함 데이터 레이어 (마이그 031).
//
// 격리 규칙은 하나다: 목록·상세는 언제나 tenantId 로 자르고, 전체를 보는 함수는 이름에
//   ForPlatform 을 달아 super_admin 전용임을 호출부에서 눈으로 구분되게 한다.
//   거래처/세션 쪽에서 "전체 조회 함수를 실수로 대리점 화면에 쓰는" 사고를 막으려고
//   쓰던 방식과 같다.

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { feedback, feedbackImages, tenants, users } from "@/lib/schema";
import type { StoredImage } from "@/lib/feedback-upload";
import {
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  type FeedbackKind,
} from "@/lib/feedback-constants";

// 상수·라벨은 @/lib/feedback-constants 에 있다 — 이 파일은 @/lib/db 를 물고 있어서
//   클라이언트 컴포넌트가 여기서 뭘 가져가면 pg 가 브라우저 번들로 끌려간다.

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
  images?: StoredImage[];
}) {
  const kind = (FEEDBACK_KINDS as readonly string[]).includes(input.kind)
    ? (input.kind as FeedbackKind)
    : "suggestion";
  const title = input.title.trim().slice(0, MAX_TITLE);
  const body = input.body.trim().slice(0, MAX_BODY);
  if (!title) throw new Error("제목을 입력하세요.");
  if (!body) throw new Error("내용을 입력하세요.");

  // 이미지는 이미 디스크에 쓰인 뒤 넘어온다. 문의 행과 함께 한 트랜잭션으로 넣어
  //   "글은 없는데 첨부만 남는" 상태를 막는다(고아 파일은 정리 작업이 걷어낸다).
  const images = input.images ?? [];
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(feedback)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        authorName: input.authorName.trim() || "(이름 없음)",
        kind,
        title,
        body,
        hadImages: images.length > 0,
      })
      .returning({ id: feedback.id });

    if (images.length > 0) {
      await tx.insert(feedbackImages).values(
        images.map((im) => ({
          feedbackId: row.id,
          tenantId: input.tenantId,
          storedName: im.storedName,
          originalName: im.originalName,
          mimeType: im.mimeType,
          byteSize: im.byteSize,
        })),
      );
    }
    return row;
  });
}

/** 문의 id 들에 달린 이미지를 한 번에 가져온다(N+1 회피). */
export async function listImagesFor(feedbackIds: number[]) {
  if (feedbackIds.length === 0) return [];
  return db
    .select({
      id: feedbackImages.id,
      feedbackId: feedbackImages.feedbackId,
      originalName: feedbackImages.originalName,
    })
    .from(feedbackImages)
    .where(inArray(feedbackImages.feedbackId, feedbackIds))
    .orderBy(feedbackImages.id);
}

/**
 * 서빙 라우트용 단건 조회. ★격리는 여기서 끝난다 —
 * super_admin 이 아니면 자기 대리점 것만 돌려준다.
 */
export async function getImageForServe(
  id: number,
  scope: { tenantId: string } | { platform: true },
) {
  const where =
    "platform" in scope
      ? eq(feedbackImages.id, id)
      : and(eq(feedbackImages.id, id), eq(feedbackImages.tenantId, scope.tenantId));

  const [row] = await db
    .select({
      storedName: feedbackImages.storedName,
      mimeType: feedbackImages.mimeType,
      originalName: feedbackImages.originalName,
    })
    .from(feedbackImages)
    .where(where)
    .limit(1);
  return row ?? null;
}

/**
 * 보관 기간이 지난 첨부를 찾는다 — 닫힌(done·declined) 문의에 달렸고 올린 지 N일 지난 것.
 * 글과 답변은 건드리지 않는다. 파일 삭제는 호출부가 하고, 여기서는 DB 행만 지운다.
 */
export async function purgeExpiredImages(olderThanDays: number) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const doomed = await db
    .select({ id: feedbackImages.id, storedName: feedbackImages.storedName })
    .from(feedbackImages)
    .innerJoin(feedback, eq(feedbackImages.feedbackId, feedback.id))
    .where(
      and(
        lt(feedbackImages.createdAt, cutoff),
        inArray(feedback.status, ["done", "declined"]),
      ),
    );
  if (doomed.length === 0) return [];
  await db.delete(feedbackImages).where(
    inArray(
      feedbackImages.id,
      doomed.map((d) => d.id),
    ),
  );
  return doomed;
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
      hadImages: feedback.hadImages,
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
      hadImages: feedback.hadImages,
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

/**
 * 삭제. 대리점은 "아직 답이 안 나간 자기 글"만, 운영자는 무엇이든.
 *
 * 대리점에 조건을 건 이유: 이미 답변이 달렸거나 검토에 들어간 건을 지우면 우리가 무엇에
 *   답했는지가 사라진다. 반대로 잘못 올린 글조차 못 지우면 그건 그것대로 답답하다 —
 *   그 사이를 "답이 나가기 전까지는 본인이 거둘 수 있다"로 그었다.
 * tenantId 를 WHERE 에 같이 넣어 남의 대리점 글은 id 를 알아도 못 지운다.
 */
export async function deleteFeedback(
  id: number,
  scope: { tenantId: string } | { platform: true },
) {
  const where =
    "platform" in scope
      ? eq(feedback.id, id)
      : and(
          eq(feedback.id, id),
          eq(feedback.tenantId, scope.tenantId),
          eq(feedback.status, "open"),
          sql`${feedback.reply} IS NULL`,
        );

  const [row] = await db
    .delete(feedback)
    .where(where)
    .returning({ id: feedback.id, tenantId: feedback.tenantId, title: feedback.title });
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
