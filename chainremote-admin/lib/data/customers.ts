// 거래처 데이터 레이어 — Server Actions(패널 UI) 와 REST API(데스크톱 앱) 양쪽이 공유.
// 프레임워크 의존 없음(revalidatePath/redirect 없음). 호출 측이 적절히 후처리.
//
// 모든 함수는 tenantId 격리 강제 — 호출자는 자기 세션의 tenantId 만 넘긴다.

import { and, desc, eq, isNull } from "drizzle-orm";
import crypto from "node:crypto";
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

/**
 * 거래처 heartbeat 토큰 발급 (자가 발급 + 1회 제약).
 *
 * Agent 가 첫 실행 시 호출. customers.heartbeat_token IS NULL 일 때만 생성·저장.
 * 이미 토큰 있거나 remote_id 매칭 customer 없으면 null 반환 (409 처리는 route 측).
 *
 * 보안 모델 (사업화 초기): 인스톨러에 토큰 못 박는 환경이라 자가 발급 우회. 공격자가
 * agent 첫 install 보다 먼저 register 호출하면 토큰 탈취 가능 — 단 install 직후 ~ 첫
 * heartbeat 사이 윈도우가 짧고 remote_id (9자리 숫자) 도 추측 필요. 매출 후 인스톨러
 * 토큰 박기 / OAuth-like 로 강화 검토.
 *
 * tenant 격리 없음 — remote_id 가 머신 UUID 기반 deterministic 이라 글로벌 unique 가정.
 */
export async function registerHeartbeatToken(remoteId: string): Promise<string | null> {
  const newToken = crypto.randomBytes(32).toString("hex");
  const [row] = await db
    .update(customers)
    .set({ heartbeatToken: newToken })
    .where(and(eq(customers.remoteId, remoteId), isNull(customers.heartbeatToken)))
    .returning({ token: customers.heartbeatToken });
  return row?.token ?? null;
}

/**
 * Heartbeat 기록. 토큰 검증 + last_heartbeat_at + last_version update.
 * 매칭 customer (remote_id + token 동시 일치) 없으면 false → route 가 403.
 */
export async function recordHeartbeat(
  remoteId: string,
  token: string,
  version: string,
): Promise<boolean> {
  const [row] = await db
    .update(customers)
    .set({ lastHeartbeatAt: new Date(), lastVersion: version })
    .where(and(eq(customers.remoteId, remoteId), eq(customers.heartbeatToken, token)))
    .returning({ id: customers.id });
  return !!row;
}
