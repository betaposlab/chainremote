"use server";

import { db } from "@/lib/db";
import { customers, tenants } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
  return session.user;
}

async function getTenantId() {
  // 현재 세션의 tenantId 사용 (멀티테넌시 격리 — 다른 테넌트 데이터 접근 차단)
  const session = await requireSession();
  return session.tenantId;
}

function pickFields(formData: FormData) {
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
  const data = pickFields(formData);
  // 등록 시 자동으로 현재 로그인 사용자를 담당자로 박음
  // (이후 거래처 수정 화면에서 다른 사용자로 재배정 가능)
  await db
    .insert(customers)
    .values({ tenantId: session.tenantId, assignedUserId: session.id, ...data });
  revalidatePath("/customers");
  redirect("/customers");
}

export async function updateCustomer(id: string, formData: FormData) {
  const tenantId = await getTenantId();
  const data = pickFields(formData);
  await db
    .update(customers)
    .set(data)
    .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)));
  revalidatePath("/customers");
  redirect("/customers");
}

export async function deleteCustomer(id: string) {
  const tenantId = await getTenantId();
  await db.delete(customers).where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)));
  revalidatePath("/customers");
}

/**
 * Mac peer 폴더에서 발견된 신규 ID를 거래처로 등록한다.
 * 상호명은 placeholder("신규 거래처 ...")로 채우고 Chang이 나중에 수정.
 */
export async function importPeer(input: {
  remoteId: string;
  hostname?: string;
  username?: string;
  platform?: string;
}) {
  const tenantId = await getTenantId();
  const placeholder = input.hostname
    ? `신규 거래처 (${input.hostname})`
    : `신규 거래처 (ID: ${input.remoteId})`;
  const platformNote = input.platform ? `${input.platform}` : "";
  const userNote = input.username ? `사용자: ${input.username}` : "";
  const notes = [platformNote, userNote].filter(Boolean).join(" / ") || null;

  const session = await requireSession();
  await db.insert(customers).values({
    tenantId,
    assignedUserId: session.id, // 발견 등록한 사용자가 기본 담당
    name: placeholder,
    remoteId: input.remoteId,
    notes,
  });
  revalidatePath("/customers");
}
