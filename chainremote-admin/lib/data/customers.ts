// 거래처 데이터 레이어 — Server Actions(패널 UI) 와 REST API(데스크톱 앱) 양쪽이 공유.
// 프레임워크 의존 없음(revalidatePath/redirect 없음). 호출 측이 적절히 후처리.
//
// 모든 함수는 tenantId 격리 강제 — 호출자는 자기 세션의 tenantId 만 넘긴다.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/schema";
import { linkFavoritesToCustomer } from "@/lib/data/favorites";
import { generateHeartbeatToken, hashHeartbeatToken } from "@/lib/heartbeat-token";

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
  // remote_id 로 등록했다면, 그 ID 의 orphan 즐겨찾기를 새 거래처에 연결.
  if (row.remoteId) {
    await linkFavoritesToCustomer(row.remoteId, row.id, ctx.tenantId);
  }
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
 * "신규 거래처 후보"(orphan 즐겨찾기)를 거래처로 등록.
 * 상호명은 placeholder, Chang 이 나중에 수정. 등록 후 같은 remote_id 의
 * orphan 즐겨찾기를 새 거래처에 연결한다(배너에서 사라지도록).
 */
export async function importPeer(
  input: { remoteId: string; hostname?: string; username?: string; platform?: string; name?: string },
  ctx: { tenantId: string; assignedUserId: string },
) {
  // 운영자가 다이얼로그에서 입력한 상호가 있으면 그것을 우선. 없으면 hostname → ID placeholder.
  const name = input.name?.trim() || (input.hostname ? `신규 거래처 (${input.hostname})` : `신규 거래처 (ID: ${input.remoteId})`);
  const platformNote = input.platform ? `${input.platform}` : "";
  const userNote = input.username ? `사용자: ${input.username}` : "";
  const notes = [platformNote, userNote].filter(Boolean).join(" / ") || null;

  const [row] = await db
    .insert(customers)
    .values({
      tenantId: ctx.tenantId,
      assignedUserId: ctx.assignedUserId,
      name,
      contactName: null,
      phone: null,
      address: null,
      remoteId: input.remoteId,
      accessPassword: null,
      notes,
    })
    .returning();
  await linkFavoritesToCustomer(input.remoteId, row.id, ctx.tenantId);
  return row;
}

/**
 * 거래처 heartbeat 토큰 발급 (자가 발급, idempotent rotation).
 *
 * Agent 가 첫 실행 시 + heartbeat 403 회복 시 호출. customer 가 remoteId 로 존재하면
 * 무조건 새 토큰 발급 + DB 갱신 + 반환. 이전 버전(2026-05-29 까지)은 isNull 조건으로
 * 1회 제약 — 인스톨 후 Agent 가 LocalConfig 토큰 잃으면 영원히 409 stuck 되는 결함.
 * 거래처 50~200곳 자동업데이트 사업화 인프라 핵심이라 idempotent 회복으로 전환.
 *
 * 보안 모델: 인스톨러에 토큰 못 박는 환경 자가 발급 그대로 유지. 공격자가 같은 remote_id
 * 로 register 호출하면 토큰 탈취 가능 (legit Agent 는 다음 tick 에서 다시 회복) — 단
 * remote_id (9자리) + HTTP only + 9시간 lock-out 등 향후 강화 검토.
 * Customer 미존재 시 null 반환 (route 가 409).
 */
export async function registerHeartbeatToken(remoteId: string): Promise<string | null> {
  // H3: 평문은 agent 에 반환, DB 엔 sha-256 해시만 저장.
  const plaintext = generateHeartbeatToken();
  const [row] = await db
    .update(customers)
    .set({ heartbeatToken: hashHeartbeatToken(plaintext) })
    .where(eq(customers.remoteId, remoteId))
    .returning({ id: customers.id });
  return row ? plaintext : null;
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
    .where(
      and(
        eq(customers.remoteId, remoteId),
        eq(customers.heartbeatToken, hashHeartbeatToken(token)), // H3: 해시 대조
      ),
    )
    .returning({ id: customers.id });
  return !!row;
}
