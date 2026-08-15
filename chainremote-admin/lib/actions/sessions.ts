"use server";

import { db } from "@/lib/db";
import { customers, supportSessions } from "@/lib/schema";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireLiveUserOrThrow } from "@/lib/auth-guard";
import * as data from "@/lib/data/sessions";
import type { IssueType, Resolution } from "@/lib/session-labels";

async function requireSession() {
  // 쿠키의 존재가 아니라 **계정이 지금도 살아 있는지**를 본다(퇴사자 즉시 차단).
  return requireLiveUserOrThrow();
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
 * [기록 폐기] — 지우지 않고 폐기 표식만(마이그045). 15초 이상 원격한 사실은 분쟁 근거라
 * 어떤 경우에도 삭제하지 않는다. 지원기록 페이지 "폐기 포함"에서 다시 볼 수 있고 되살릴 수 있다.
 */
export async function discardSession(id: string) {
  const me = await requireSession();
  await data.discardSessionSoft(id, me.tenantId);
  revalidatePath("/customers");
  revalidatePath("/sessions");
}

/** 폐기 취소. */
export async function restoreSession(id: string) {
  const me = await requireSession();
  await data.restoreSession(id, me.tenantId);
  revalidatePath("/sessions");
}

const ISSUE_TYPES = ["config", "hardware", "software", "network", "training", "other"] as const;
const RESOLUTIONS = ["resolved", "pending", "escalated", "in_progress"] as const;

function readRecordFields(formData: FormData) {
  const issueRaw = String(formData.get("issueType") ?? "");
  const resRaw = String(formData.get("resolution") ?? "");
  // A/S 종류는 체크박스 여러 개 → 콤마 조인(HQ 와 같은 저장 형식).
  const cats = formData
    .getAll("categories")
    .map((v) => String(v).trim())
    .filter(Boolean);
  return {
    issueType: ISSUE_TYPES.includes(issueRaw as never) ? (issueRaw as IssueType) : null,
    resolution: RESOLUTIONS.includes(resRaw as never) ? (resRaw as Resolution) : null,
    contactName: String(formData.get("contactName") ?? ""),
    categories: cats.join(","),
    description: String(formData.get("description") ?? ""),
  };
}

/**
 * 사후 편집 (지원기록 페이지의 [기록 편집]) — 끝났든 미기록이든 폐기됐든 내용을 채운다.
 * 시간은 안 건드린다(원격 시간은 사실 기록).
 */
export async function updateSession(id: string, formData: FormData) {
  const me = await requireSession();
  const f = readRecordFields(formData);
  await data.updateSessionRecord(id, me.tenantId, {
    ...f,
    // 해결 여부를 비워 보내면 그대로 둔다(폐기 행 편집 등).
    resolution: f.resolution ?? undefined,
  });
  revalidatePath("/sessions");
}

/**
 * 수동 기록 추가 — 원격 없이 처리한 A/S(전화) 나 실수로 지운 기록을 손으로 남긴다.
 * 담당은 로그인한 본인. 시각은 브라우저 로컬(datetime-local)을 ISO 로 받는다.
 */
export async function createManualSession(formData: FormData): Promise<{ ok: true } | { error: string }> {
  const me = await requireSession();
  const customerId = String(formData.get("customerId") ?? "");
  const startedAt = new Date(String(formData.get("startedAt") ?? ""));
  const endedAt = new Date(String(formData.get("endedAt") ?? ""));
  if (!customerId) return { error: "거래처를 고르세요" };
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()))
    return { error: "시작·종료 시각을 넣으세요" };
  if (endedAt.getTime() < startedAt.getTime()) return { error: "종료가 시작보다 앞섭니다" };
  if (startedAt.getTime() > Date.now() + 60_000) return { error: "미래 시각입니다" };
  const f = readRecordFields(formData);
  if (!f.description.trim()) return { error: "지원 내용을 적으세요 — 수동 기록은 내용이 전부입니다" };
  try {
    await data.createManualSession({
      tenantId: me.tenantId,
      operatorId: me.id,
      customerId,
      startedAt,
      endedAt,
      fields: { ...f, resolution: f.resolution ?? "resolved" },
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "저장 실패" };
  }
  revalidatePath("/sessions");
  revalidatePath("/customers");
  return { ok: true };
}
