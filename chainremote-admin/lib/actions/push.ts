"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import * as data from "@/lib/data/pending-updates";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
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
