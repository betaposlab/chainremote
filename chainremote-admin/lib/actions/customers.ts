"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import * as data from "@/lib/data/customers";
import * as favData from "@/lib/data/favorites";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
  return session.user;
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
  return {
    name,
    contactName: get("contactName"),
    phone: get("phone"),
    address: get("address"),
    remoteId: get("remoteId"),
    accessPassword: get("accessPassword"),
    notes: get("notes"),
  };
}

export async function createCustomer(formData: FormData) {
  const session = await requireSession();
  await data.createCustomer(pickFields(formData), {
    tenantId: session.tenantId,
    assignedUserId: session.id,
  });
  revalidatePath("/customers");
  redirect("/customers");
}

export async function updateCustomer(id: string, formData: FormData) {
  const session = await requireSession();
  await data.updateCustomer(id, pickFields(formData), { tenantId: session.tenantId });
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

// 자가등록(⑤) 후보 거래처 확정 — enroll_status 'pending'→'active'. HQ 가 패널서 '확인' 클릭.
export async function confirmEnrollment(id: string) {
  const session = await requireSession();
  await data.confirmEnrollment(id, { tenantId: session.tenantId });
  revalidatePath("/customers");
}

// "신규 거래처 후보"(orphan 즐겨찾기) 무시/삭제 — 그 remote_id 의 미등록 즐겨찾기를 테넌트서 제거.
// 테스트 머신 등 거래처로 등록 안 할 후보를 배너에서 치울 때.
export async function dismissCandidate(remoteId: string) {
  const session = await requireSession();
  await favData.dismissOrphanCandidate(session.tenantId, remoteId);
  revalidatePath("/customers");
}
