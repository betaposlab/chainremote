"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import * as data from "@/lib/data/customers";
import * as favData from "@/lib/data/favorites";
import { listTenantStaff } from "@/lib/data/users";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
  return session.user;
}

// 담당 배정 검증 — assignedUserId 가 이 테넌트 소속 직원일 때만 통과(타테넌트 배정 차단).
// 빈값/미소속이면 null(미배정).
async function sanitizeAssignee(
  assignedUserId: string | null | undefined,
  tenantId: string,
): Promise<string | null> {
  if (!assignedUserId) return null;
  const staff = await listTenantStaff(tenantId);
  return staff.some((s) => s.id === assignedUserId) ? assignedUserId : null;
}

function pickFields(formData: FormData): data.CustomerFields {
  const get = (k: string) => {
    const v = formData.get(k);
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed === "" ? null : trimmed;
  };
  const name = get("name");
  if (!name) throw new Error("상호는 필수입니다");
  // 원격 ID 정규화 — 공백 제거 + 대문자화. 매칭은 대소문자 구분 eq 라
  // 에이전트 저장값(대문자·공백없음)과 정확히 일치해야 한다. 신형 AB ID·구형 숫자 공통.
  const rawRemoteId = get("remoteId");
  const remoteId = rawRemoteId ? rawRemoteId.replace(/\s+/g, "").toUpperCase() : null;
  return {
    name,
    contactName: get("contactName"),
    phone: get("phone"),
    address: get("address"),
    remoteId,
    accessPassword: get("accessPassword"),
    notes: get("notes"),
    assignedUserId: get("assignedUserId"),
  };
}

export async function createCustomer(formData: FormData) {
  const session = await requireSession();
  const fields = pickFields(formData);
  fields.assignedUserId = await sanitizeAssignee(fields.assignedUserId, session.tenantId);
  // 담당 미선택 시 생성자로 폴백(폴백 처리는 data.createCustomer 안).
  await data.createCustomer(fields, {
    tenantId: session.tenantId,
    assignedUserId: session.id,
  });
  revalidatePath("/customers");
  redirect("/customers");
}

export async function updateCustomer(id: string, formData: FormData) {
  const session = await requireSession();
  const fields = pickFields(formData);
  fields.assignedUserId = await sanitizeAssignee(fields.assignedUserId, session.tenantId);
  await data.updateCustomer(id, fields, { tenantId: session.tenantId });
  revalidatePath("/customers");
  redirect("/customers");
}

export async function deleteCustomer(id: string) {
  const session = await requireSession();
  await data.deleteCustomer(id, { tenantId: session.tenantId });
  revalidatePath("/customers");
}

export async function importPeer(input: {
  remoteId: string;
  hostname?: string;
  username?: string;
  platform?: string;
  name?: string;
}) {
  const session = await requireSession();
  await data.importPeer(input, {
    tenantId: session.tenantId,
    assignedUserId: session.id,
  });
  revalidatePath("/customers");
}

// 자가등록 후보 거래처 확정 — enroll_status 'pending'→'active'. HQ 가 패널서 '확인' 클릭.
export async function confirmEnrollment(id: string) {
  const session = await requireSession();
  await data.confirmEnrollment(id, { tenantId: session.tenantId });
  revalidatePath("/customers");
}

// "신규 거래처 후보"(orphan 즐겨찾기) 무시 — 그 remote_id 의 미등록 즐겨찾기를 테넌트서 제거.
// 테스트 머신처럼 등록 안 할 후보를 배너에서 치울 때.
export async function dismissCandidate(remoteId: string) {
  const session = await requireSession();
  await favData.dismissOrphanCandidate(session.tenantId, remoteId);
  revalidatePath("/customers");
}

// [디스크 정리] — Temp+휴지통 원격 정리 명령 큐잉. 원격 지원에 준하는 행위라 viewer 만 제외.
// 에이전트가 다음 heartbeat(≤10분)에 받아 실행하고 결과를 보고한다.
export async function requestCleanupAction(remoteId: string): Promise<boolean> {
  const session = await requireSession();
  if (session.role === "viewer") throw new Error("권한 없음");
  const ok = await data.requestCleanup(remoteId, { tenantId: session.tenantId });
  revalidatePath("/customers");
  return ok;
}
