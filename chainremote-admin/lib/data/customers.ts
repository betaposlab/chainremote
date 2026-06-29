// 거래처 데이터 레이어 — Server Actions(패널 UI) 와 REST API(데스크톱 앱) 양쪽이 공유.
// 프레임워크 의존 없음(revalidatePath/redirect 없음). 호출 측이 적절히 후처리.
//
// 모든 함수는 tenantId 격리 강제 — 호출자는 자기 세션의 tenantId 만 넘긴다.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, tenants } from "@/lib/schema";
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

/**
 * tenant 인증 해소(⑤ auto-enroll) — agent 가 custom.txt 에 구워온 (slug + enroll-key)로 tenant 식별.
 * enroll-key 는 sha-256 해시로 tenants.enroll_secret_hash 와 대조(recordHeartbeat 의 토큰 해시대조와 동일).
 * slug/key 불일치 · 비활성 tenant · enroll-secret 미설정 → null (route 가 403).
 */
export async function resolveTenantByEnroll(
  slug: string,
  enrollKey: string,
): Promise<string | null> {
  if (!slug || !enrollKey) return null;
  const [row] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(
      and(
        eq(tenants.slug, slug),
        eq(tenants.enrollSecretHash, hashHeartbeatToken(enrollKey)), // H3: 해시 대조
        eq(tenants.isActive, true),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * 거래처 agent 자가등록(⑤). 인증된 tenant 안에서 remote_id 로:
 *  - 신규: 'pending'(후보) 거래처 생성 + heartbeat 토큰 발급 → HQ 가 패널서 확인하면 'active'.
 *  - 기존(같은 tenant): 토큰만 회전(재등록/토큰분실 자가복구 = registerHeartbeatToken 정책;
 *      enroll_status 는 안 건드림 — 이미 확정된 거래처를 pending 으로 되돌리지 않음).
 *  - 기존(다른 tenant): "cross_tenant" 거부(remote_id 글로벌 unique[011] 위 cross-tenant 탈취 차단).
 * 동시 enroll 레이스는 unique 위반 catch 후 재조회→회전으로 수렴.
 */
export async function enrollCustomer(
  input: { remoteId: string; name?: string; hostname?: string },
  ctx: { tenantId: string },
): Promise<{ token: string; created: boolean } | "cross_tenant"> {
  const remoteId = input.remoteId.trim();
  const plaintext = generateHeartbeatToken();
  const tokenHash = hashHeartbeatToken(plaintext);

  // 1) 기존 행(전역 unique remote_id) 확인.
  const [existing] = await db
    .select({ id: customers.id, tenantId: customers.tenantId })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  if (existing) {
    if (existing.tenantId !== ctx.tenantId) return "cross_tenant";
    await db
      .update(customers)
      .set({ heartbeatToken: tokenHash })
      .where(eq(customers.id, existing.id));
    return { token: plaintext, created: false };
  }

  // 2) 신규 — ★바로 정식 거래처로 등록(active). 2026-06-29 Chang 결정:
  //   설치 시 상호 입력 = 등록 의사 + 설치파일이 per-tenant enroll-key 라 아무나 못 넣음
  //   → "후보→확인" 이중작업 불필요. 과금은 패널 밖에서 별도 관리. 잘못/테스트 설치는 삭제로 처리.
  //   (옛 'pending 후보 + ✓확인' 흐름 폐기. 상호 없으면 importPeer 관례 placeholder.)
  const name =
    input.name?.trim() ||
    (input.hostname?.trim()
      ? `신규 거래처 (${input.hostname.trim()})`
      : `신규 거래처 (ID: ${remoteId})`);
  try {
    const [row] = await db
      .insert(customers)
      .values({
        tenantId: ctx.tenantId,
        name,
        remoteId,
        enrollStatus: "active",
        heartbeatToken: tokenHash,
      })
      .returning({ id: customers.id });
    await linkFavoritesToCustomer(remoteId, row.id, ctx.tenantId);
    return { token: plaintext, created: true };
  } catch (e) {
    // 동시 enroll 레이스 — 방금 다른 요청이 같은 remote_id 를 넣음(uq_customers_remote_id 위반).
    //   재조회 후 토큰 회전으로 수렴. 행이 여전히 없으면 unique 외 에러라 재throw.
    const [row] = await db
      .select({ id: customers.id, tenantId: customers.tenantId })
      .from(customers)
      .where(eq(customers.remoteId, remoteId))
      .limit(1);
    if (!row) throw e;
    if (row.tenantId !== ctx.tenantId) return "cross_tenant";
    await db
      .update(customers)
      .set({ heartbeatToken: tokenHash })
      .where(eq(customers.id, row.id));
    return { token: plaintext, created: false };
  }
}

/** 자가등록(⑤) 후보 거래처 확정 — enroll_status 'pending'→'active'. HQ 가 패널서 '확인' 클릭.
 *  확정돼야 일괄푸시/버전관리 대상에 포함(pending-updates.ts). 이미 active 거나 타 tenant 면 무변경(false). */
export async function confirmEnrollment(
  id: string,
  ctx: { tenantId: string },
): Promise<boolean> {
  const [row] = await db
    .update(customers)
    .set({ enrollStatus: "active", updatedAt: new Date() })
    .where(
      and(
        eq(customers.id, id),
        eq(customers.tenantId, ctx.tenantId),
        eq(customers.enrollStatus, "pending"),
      ),
    )
    .returning({ id: customers.id });
  return !!row;
}

/** confirmEnrollment 의 remote_id 버전 — HQ '전체 거래처' 탭에서 마스터가 9자리 ID 로 확정.
 *  remote_id 는 테넌트 내 unique 라 최대 1행. 이미 active/타 tenant/미등록이면 무변경(false). */
export async function confirmEnrollmentByRemoteId(
  remoteId: string,
  ctx: { tenantId: string },
): Promise<boolean> {
  const [row] = await db
    .update(customers)
    .set({ enrollStatus: "active", updatedAt: new Date() })
    .where(
      and(
        eq(customers.remoteId, remoteId),
        eq(customers.tenantId, ctx.tenantId),
        eq(customers.enrollStatus, "pending"),
      ),
    )
    .returning({ id: customers.id });
  return !!row;
}
