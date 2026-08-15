"use server";

// 거래처 알림 처리 액션 — 기기 이동/개명/무시.

import { revalidatePath } from "next/cache";
import { requireLiveUserOrThrow } from "@/lib/auth-guard";
import * as data from "@/lib/data/alerts";
import { canWrite } from "@/lib/roles";

// 기기 이동/개명/무시 = 거래처 작업이라 직원 포함 전원이 한다(3역할 체계, 2026-07-25).
// 계정 관리만 대표자·관리자로 제한된다 — lib/actions/users.ts 참조.
async function requireOwnerSession() {
  // 쿠키의 존재가 아니라 **계정이 지금도 살아 있는지**를 본다(퇴사자 즉시 차단).
  //   role 도 DB 현재값이라 권한 강등이 다음 클릭부터 바로 먹는다.
  const session = { user: await requireLiveUserOrThrow() };
  if (!canWrite(session.user.role)) {
    throw new Error("읽기 전용 계정은 이 작업 권한이 없습니다");
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
