// 거래처 데이터 레이어 — Server Actions(패널 UI) 와 REST API(데스크톱 앱) 양쪽이 공유.
// 프레임워크 의존 없음(revalidatePath/redirect 없음). 호출 측이 적절히 후처리.
//
// 모든 함수는 tenantId 격리 강제 — 호출자는 자기 세션의 tenantId 만 넘긴다.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/schema";

export interface CustomerFields {
  name: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  remoteId: string | null;
  accessPassword: string | null;
  notes: string | null;
}

export async function listCustomers(tenantId: string) {
  return db
    .select()
    .from(customers)
    .where(eq(customers.tenantId, tenantId))
    .orderBy(desc(customers.updatedAt));
}

export async function getCustomer(id: string, tenantId: string) {
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createCustomer(
  fields: CustomerFields,
  ctx: { tenantId: string; assignedUserId: string },
) {
  const [row] = await db
    .insert(customers)
    .values({
      tenantId: ctx.tenantId,
      assignedUserId: ctx.assignedUserId,
      ...fields,
    })
    .returning();
  return row;
}

export async function updateCustomer(
  id: string,
  fields: CustomerFields,
  ctx: { tenantId: string },
) {
  const [row] = await db
    .update(customers)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
    .returning();
  return row ?? null;
}

export async function deleteCustomer(id: string, ctx: { tenantId: string }) {
  const result = await db
    .delete(customers)
    .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
    .returning({ id: customers.id });
  return result.length > 0;
}

/**
 * Mac peer 폴더에서 발견된 신규 ID 를 거래처로 등록.
 * 상호명은 placeholder, Chang 이 나중에 수정.
 */
export async function importPeer(
  input: { remoteId: string; hostname?: string; username?: string; platform?: string },
  ctx: { tenantId: string; assignedUserId: string },
) {
  const placeholder = input.hostname
    ? `신규 거래처 (${input.hostname})`
    : `신규 거래처 (ID: ${input.remoteId})`;
  const platformNote = input.platform ? `${input.platform}` : "";
  const userNote = input.username ? `사용자: ${input.username}` : "";
  const notes = [platformNote, userNote].filter(Boolean).join(" / ") || null;

  const [row] = await db
    .insert(customers)
    .values({
      tenantId: ctx.tenantId,
      assignedUserId: ctx.assignedUserId,
      name: placeholder,
      contactName: null,
      phone: null,
      address: null,
      remoteId: input.remoteId,
      accessPassword: null,
      notes,
    })
    .returning();
  return row;
}
