"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import * as data from "@/lib/data/customers";

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
}) {
  const session = await requireSession();
  await data.importPeer(input, {
    tenantId: session.tenantId,
    assignedUserId: session.id,
  });
  revalidatePath("/customers");
}
