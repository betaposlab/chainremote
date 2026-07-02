// 지원 세션 데이터 레이어 — 본사 앱(내 최근 세션) + 패널(전체 이력) 공유.

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, supportSessions, users } from "@/lib/schema";

/**
 * 내가 최근에 접속한 세션들 + 거래처 정보.
 * 같은 거래처가 중복될 수 있으니 클라이언트에서 customer_id 별 dedupe 권장.
 */
export async function listMyRecentSessions(
  operatorId: string,
  tenantId: string,
  limit = 30,
) {
  return db
    .select({
      session: supportSessions,
      customer: customers,
    })
    .from(supportSessions)
    .leftJoin(customers, eq(customers.id, supportSessions.customerId))
    .where(
      and(
        eq(supportSessions.operatorId, operatorId),
        eq(supportSessions.tenantId, tenantId),
      ),
    )
    .orderBy(desc(supportSessions.startedAt))
    .limit(limit);
}

/**
 * 아직 안 끝난(endedAt 없음) 세션 목록 — 테넌트 전체 presence 표시용.
 * "재성이가 진희씨컴 접속 중" 같은 UI.
 */
export async function listActiveSessions(tenantId: string) {
  return db
    .select({
      session: supportSessions,
      customer: customers,
      operatorName: users.displayName,
      operatorEmail: users.email,
    })
    .from(supportSessions)
    .leftJoin(customers, eq(customers.id, supportSessions.customerId))
    .leftJoin(users, eq(users.id, supportSessions.operatorId))
    .where(
      and(
        eq(supportSessions.tenantId, tenantId),
        isNull(supportSessions.endedAt),
      ),
    )
    .orderBy(desc(supportSessions.startedAt));
}

/**
 * 세션 시작 — 본사 앱/패널 양쪽에서 호출.
 * 같은 직원이 같은 거래처에 이미 활성 세션이 있으면 재사용해 중복을 막는다.
 * 다른 직원의 활성 세션은 무시 — chang/jaesung 동시 접속 허용 (정책 #4).
 */
export async function startSession(input: {
  tenantId: string;
  operatorId: string;
  customerId: string;
  remoteId: string | null;
}) {
  const existing = await db
    .select()
    .from(supportSessions)
    .where(
      and(
        eq(supportSessions.tenantId, input.tenantId),
        eq(supportSessions.operatorId, input.operatorId),
        eq(supportSessions.customerId, input.customerId),
        isNull(supportSessions.endedAt),
      ),
    )
    .limit(1);
  if (existing.length) return existing[0];

  const [row] = await db
    .insert(supportSessions)
    .values({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      customerId: input.customerId,
      remoteId: input.remoteId,
      resolution: "in_progress",
    })
    .returning();
  return row;
}

/** 세션 종료 — 본사 앱이 원격 창 닫을 때 호출 */
export async function endSession(
  sessionId: string,
  tenantId: string,
): Promise<void> {
  const now = new Date();
  // endedAt 만 세팅하고 duration 은 응용층에서 계산 (started_at 을 다시 SELECT 하지 않게).
  await db
    .update(supportSessions)
    .set({ endedAt: now })
    .where(
      and(eq(supportSessions.id, sessionId), eq(supportSessions.tenantId, tenantId)),
    );
}
