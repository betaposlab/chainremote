"use server";

// 거래처 알림 처리 액션 — 기기 이동/개명/무시는 거래처 데이터를 바꾸므로 마스터(owner) 전용.
// (거래처 수정·삭제 = owner 만 — 기존 권한 규칙 그대로.)

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import * as data from "@/lib/data/alerts";

async function requireOwnerSession() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
  const role = session.user.role;
  if (role !== "owner" && role !== "super_admin") {
    throw new Error("마스터(owner) 권한 필요");
  }
  return session.user;
}

export async function resolveAlertAction(id: string): Promise<boolean> {
  const me = await requireOwnerSession();
  const ok = await data.resolveAlert(id, me.tenantId);
  revalidatePath("/customers");
  return ok;
}

export async function renameFromAlertAction(id: string): Promise<boolean> {
  const me = await requireOwnerSession();
  const ok = await data.applyAlertRename(id, me.tenantId);
  revalidatePath("/customers");
  return ok;
}

export async function moveFromAlertAction(id: string): Promise<boolean> {
  const me = await requireOwnerSession();
  const ok = await data.applyAlertMoveToNew(id, me.tenantId);
  revalidatePath("/customers");
  return ok;
}
