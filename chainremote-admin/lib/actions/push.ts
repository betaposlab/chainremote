"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import * as data from "@/lib/data/pending-updates";
import { canWrite } from "@/lib/roles";
import { writeAudit } from "@/lib/data/audit";

// 푸시는 거래처 작업이라 직원 포함 전원이 한다(3역할 체계, 2026-07-25) — 레거시 viewer 만
// 막는다. 다른 액션(alerts.ts 등)은 처음부터 canWrite 로 걸러왔는데 여기만 빠져 있었다.
// 하필 푸시는 살아있는 플릿 전체에 설치를 거는 동작이라, 읽기 전용 계정이 닿으면 안 된다.
async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
  if (!canWrite(session.user.role)) {
    throw new Error("읽기 전용 계정은 이 작업 권한이 없습니다");
  }
  return session.user;
}

function pickAsset(formData: FormData): data.PushAsset {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const targetVersion = get("targetVersion");
  const assetUrl = get("assetUrl");
  const assetSha256 = get("assetSha256");
  const assetSizeStr = get("assetSize");
  if (!targetVersion) throw new Error("targetVersion 필수");
  if (!assetUrl) throw new Error("assetUrl 필수");
  if (!assetSha256) throw new Error("assetSha256 필수");
  const assetSize = Number(assetSizeStr);
  if (!Number.isFinite(assetSize) || assetSize <= 0) throw new Error("assetSize 가 유효하지 않음");
  return { targetVersion, assetUrl, assetSha256, assetSize };
}

function pickOptions(formData: FormData): data.PushOptions {
  const num = (k: string) => {
    const v = formData.get(k);
    if (typeof v !== "string") return undefined;
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    windowStartHour: num("windowStartHour"),
    windowEndHour: num("windowEndHour"),
    randomizeMaxSec: num("randomizeMaxSec"),
  };
}

/**
 * 단일 거래처 푸시. 거래처 표 행의 [v1.3.5 푸시] 버튼.
 */
export async function pushToCustomerAction(customerId: string, formData: FormData) {
  const session = await requireSession();
  const asset = pickAsset(formData);
  const opts = pickOptions(formData);
  const row = await data.pushToCustomer(customerId, asset, opts, {
    tenantId: session.tenantId,
    requestedBy: session.id,
  });
  revalidatePath("/customers");
  return { ok: !!row, alreadyQueued: !row };
}

/**
 * 일괄 푸시. 거래처 표 상단의 [전체 일괄 푸시] 버튼.
 */
export async function pushBulkAction(formData: FormData) {
  const session = await requireSession();
  const asset = pickAsset(formData);
  const opts = pickOptions(formData);
  const result = await data.pushBulk(asset, opts, {
    tenantId: session.tenantId,
    requestedBy: session.id,
  });
  // 살아있는 플릿 전체에 설치를 거는 동작이라 남긴다. 나중에 "그날 왜 다 업뎃됐지"
  // 를 되짚을 유일한 단서다.
  await writeAudit({
    action: "push.bulk",
    tenantId: session.tenantId,
    userId: session.id,
    targetType: "bulk_batch",
    metadata: {
      targetVersion: asset.targetVersion,
      eligible: result.eligible,
      inserted: result.inserted,
      bulkBatchId: result.bulkBatchId,
    },
  });
  revalidatePath("/customers");
  return result;
}

/**
 * 푸시 취소. 대기 중인 1건 취소.
 */
export async function cancelPushAction(pushId: string) {
  const session = await requireSession();
  const ok = await data.cancelPush(pushId, { tenantId: session.tenantId });
  revalidatePath("/customers");
  return { ok };
}

/**
 * 일괄 취소.
 */
export async function cancelBulkAction(bulkBatchId: string) {
  const session = await requireSession();
  const cancelled = await data.cancelBulk(bulkBatchId, { tenantId: session.tenantId });
  revalidatePath("/customers");
  return { cancelled };
}
