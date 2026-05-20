"use server";

import { db } from "@/lib/db";
import { customers, supportSessions } from "@/lib/schema";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import * as data from "@/lib/data/sessions";
import type { IssueType, Resolution } from "@/lib/session-labels";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
  return session.user;
}

/**
 * 원격 접속 시작 시 호출. 같은 직원이 같은 거래처에 활성 세션이 이미 있으면 그것을 재사용.
 * 다른 직원의 세션은 무시 — 동시 접속 허용.
 * 반환: 세션 ID
 */
export async function startSession(customerId: string): Promise<string> {
  const me = await requireSession();
  const customer = (
    await db
      .select({ remoteId: customers.remoteId })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, me.tenantId)))
      .limit(1)
  )[0];

  const row = await data.startSession({
    tenantId: me.tenantId,
    operatorId: me.id,
    customerId,
    remoteId: customer?.remoteId ?? null,
  });
  revalidatePath("/customers");
  revalidatePath("/sessions");
  return row.id;
}

/**
 * 세션 종료 + 지원기록 내용 저장.
 */
export async function endSession(id: string, formData: FormData) {
  const me = await requireSession();
  const issueType = (formData.get("issueType") || null) as IssueType | null;
  const resolution = (formData.get("resolution") || "resolved") as Resolution;
  const description = ((formData.get("description") as string) || "").trim() || null;

  // duration_sec 는 DB 에서 자동 계산되는 generated 컬럼 — 직접 박지 않음.
  await db
    .update(supportSessions)
    .set({
      endedAt: sql`now()`,
      issueType: issueType ?? undefined,
      resolution,
      description,
    })
    .where(and(eq(supportSessions.id, id), eq(supportSessions.tenantId, me.tenantId)));

  revalidatePath("/customers");
  revalidatePath("/sessions");
}

/**
 * 잘못 시작한 세션 폐기.
 */
export async function discardSession(id: string) {
  const me = await requireSession();
  await db
    .delete(supportSessions)
    .where(and(eq(supportSessions.id, id), eq(supportSessions.tenantId, me.tenantId)));
  revalidatePath("/customers");
  revalidatePath("/sessions");
}

/**
 * 사후 수정 (지원기록 페이지의 행 수정).
 */
export async function updateSession(id: string, formData: FormData) {
  const me = await requireSession();
  const issueType = (formData.get("issueType") || null) as IssueType | null;
  const resolution = (formData.get("resolution") || "resolved") as Resolution;
  const description = ((formData.get("description") as string) || "").trim() || null;

  await db
    .update(supportSessions)
    .set({
      issueType: issueType ?? undefined,
      resolution,
      description,
    })
    .where(and(eq(supportSessions.id, id), eq(supportSessions.tenantId, me.tenantId)));
  revalidatePath("/sessions");
}
