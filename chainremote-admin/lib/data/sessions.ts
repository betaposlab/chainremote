// 지원 세션 데이터 레이어 — 본사 앱(내 최근 세션) + 패널(전체 이력) 공유.

import { and, desc, eq, isNull, sql } from "drizzle-orm";
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
  /** 이 연결이 직결(P2P)인가(마이그038). undefined = 미보고(구버전 HQ). */
  connDirect?: boolean;
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

  // ON CONFLICT DO NOTHING — 마이그 025 partial unique(같은 직원·거래처 활성 1세션)와 짝.
  //   select-then-insert 경합으로 두 요청이 동시에 여기 도달해도 두 번째 insert 는 충돌해
  //   행을 안 만든다(중복 방지).
  const [row] = await db
    .insert(supportSessions)
    .values({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      customerId: input.customerId,
      remoteId: input.remoteId,
      resolution: "in_progress",
      connDirect: input.connDirect,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;

  // 동시 삽입이 충돌해 이 요청은 행을 못 만들었다 — 방금 다른 요청이 만든 활성 세션을 반환.
  const [raced] = await db
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
  return raced;
}

/** 세션 종료 — 본사 앱이 원격 창 닫을 때 호출 */
export type EndSessionFields = {
  categories?: string; // A/S 종류 멀티(콤마 조인, 예 "printer,payment")
  description?: string; // A/S 내용
  contactName?: string; // 거래처측 응대자
  resolution?: "resolved" | "pending" | "escalated" | "in_progress"; // 처리결과
};

/**
 * 세션 종료 — endedAt + duration(DB 에서 started_at 기준 계산) 세팅.
 * fields 는 전부 선택적(HQ 모달에서 안 적거나 스킵하면 빈 채로) — 값이 온 것만 반영, 나머지 보존.
 */
export async function endSession(
  sessionId: string,
  tenantId: string,
  fields?: EndSessionFields,
): Promise<void> {
  await db
    .update(supportSessions)
    .set({
      // duration_sec 은 DB 생성컬럼(001_init: GENERATED ALWAYS AS ended_at-started_at) — 직접
      //   세팅 금지. ended_at 만 넣으면 DB 가 자동 계산한다.
      // 첫 종료 시각을 보존(COALESCE) — HQ 는 끊자마자 시간을 기록하고, A/S 내용은 메인 창
      //   모달에서 나중에 보강한다. 보강 저장이 ended_at 을 밀면 원격 시간이 부풀므로 금지.
      endedAt: sql`COALESCE(${supportSessions.endedAt}, now())`,
      ...(fields?.categories?.trim() ? { categories: fields.categories.trim() } : {}),
      ...(fields?.description?.trim() ? { description: fields.description.trim() } : {}),
      ...(fields?.contactName?.trim() ? { contactName: fields.contactName.trim() } : {}),
      ...(fields?.resolution ? { resolution: fields.resolution } : {}),
    })
    .where(
      and(eq(supportSessions.id, sessionId), eq(supportSessions.tenantId, tenantId)),
    );
}

/** 아주 짧은 오접속(모달도 안 뜬 <N초)이나 취소된 세션 삭제 — 노이즈 이력 방지. */
export async function discardSession(sessionId: string, tenantId: string): Promise<void> {
  await db
    .delete(supportSessions)
    .where(
      and(eq(supportSessions.id, sessionId), eq(supportSessions.tenantId, tenantId)),
    );
}

/** 거래처별 지원 이력 — HQ 거래처 카드 "지원이력" + 상세. 최신순. */
export async function listCustomerSessions(
  customerId: string,
  tenantId: string,
  limit = 100,
) {
  return db
    .select({ session: supportSessions, operatorName: users.displayName })
    .from(supportSessions)
    .leftJoin(users, eq(users.id, supportSessions.operatorId))
    .where(
      and(
        eq(supportSessions.customerId, customerId),
        eq(supportSessions.tenantId, tenantId),
      ),
    )
    .orderBy(desc(supportSessions.startedAt))
    .limit(limit);
}

/** 전체 지원기록 타임라인 — HQ "지원 기록" 뷰(전 직원, 전 거래처). 최신순. */
export async function listRecentSessions(
  tenantId: string,
  limit = 100,
  remoteId?: string,
) {
  const conds = [eq(supportSessions.tenantId, tenantId)];
  // remoteId 주면 그 거래처만 (HQ 거래처 카드 "지원이력"). 없으면 전체 타임라인.
  if (remoteId) conds.push(eq(customers.remoteId, remoteId));
  return db
    .select({
      session: supportSessions,
      customer: customers,
      operatorName: users.displayName,
    })
    .from(supportSessions)
    .leftJoin(customers, eq(customers.id, supportSessions.customerId))
    .leftJoin(users, eq(users.id, supportSessions.operatorId))
    .where(and(...conds))
    .orderBy(desc(supportSessions.startedAt))
    .limit(limit);
}
