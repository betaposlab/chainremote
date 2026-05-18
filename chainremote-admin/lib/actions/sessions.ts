"use server";

import { db } from "@/lib/db";
import { customers, supportSessions, tenants } from "@/lib/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { IssueType, Resolution } from "@/lib/session-labels";

async function getTenantId() {
  const t = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, "betaposlab"))
    .limit(1);
  if (!t.length) throw new Error("Tenant not found");
  return t[0].id;
}

/**
 * 원격 접속 시작 시 호출. 거래처별로 종료 안 된 활성 세션이 이미 있으면 그것을 재사용한다.
 * 반환: 세션 ID
 */
export async function startSession(customerId: string): Promise<string> {
  const tenantId = await getTenantId();

  const existing = await db
    .select({ id: supportSessions.id })
    .from(supportSessions)
    .where(
      and(
        eq(supportSessions.tenantId, tenantId),
        eq(supportSessions.customerId, customerId),
        isNull(supportSessions.endedAt),
      ),
    )
    .limit(1);

  if (existing.length) {
    return existing[0].id;
  }

  const customer = (
    await db
      .select({ remoteId: customers.remoteId })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
      .limit(1)
  )[0];

  const inserted = await db
    .insert(supportSessions)
    .values({
      tenantId,
      customerId,
      remoteId: customer?.remoteId ?? null,
      resolution: "in_progress",
    })
    .returning({ id: supportSessions.id });

  revalidatePath("/customers");
  revalidatePath("/sessions");
  return inserted[0].id;
}

/**
 * 세션 종료 + 지원기록 내용 저장.
 */
export async function endSession(id: string, formData: FormData) {
  const tenantId = await getTenantId();
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
    .where(and(eq(supportSessions.id, id), eq(supportSessions.tenantId, tenantId)));

  revalidatePath("/customers");
  revalidatePath("/sessions");
}

/**
 * 잘못 시작한 세션 폐기.
 */
export async function discardSession(id: string) {
  const tenantId = await getTenantId();
  await db
    .delete(supportSessions)
    .where(and(eq(supportSessions.id, id), eq(supportSessions.tenantId, tenantId)));
  revalidatePath("/customers");
  revalidatePath("/sessions");
}

/**
 * 사후 수정 (지원기록 페이지의 행 수정).
 */
export async function updateSession(id: string, formData: FormData) {
  const tenantId = await getTenantId();
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
    .where(and(eq(supportSessions.id, id), eq(supportSessions.tenantId, tenantId)));
  revalidatePath("/sessions");
}
