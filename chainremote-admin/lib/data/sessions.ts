// 지원 세션 데이터 레이어 — 본사 앱(내 최근 세션) + 패널(전체 이력) 공유.

import { and, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activeLoginSessions, customers, supportSessions, users } from "@/lib/schema";

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
        isNull(supportSessions.discardedAt),
      ),
    )
    .orderBy(desc(supportSessions.startedAt))
    .limit(limit);
}

/**
 * 고아 세션 자동 마감 — 직원의 HQ 가 죽었는데(강제 종료·PC 절전·크래시) 종료 보고를 못 보낸
 * `in_progress` 세션을 서버가 닫는다. 판정 기준은 좌석 하트비트(active_login_sessions,
 * 5초 주기·orphan TTL 2분 = 좌석 enforcement 와 같은 잣대): 그 직원의 살아있는 좌석이 없으면
 * HQ 도 없는 것이고, HQ 가 없으면 그 원격 창도 없다.
 *
 * ★2026-08-15 토니피자 건이 계기 — 재성 HQ 가 14:53 에 사라졌는데 세션은 한 시간 넘게
 *   "지원 중"으로 빨갛게 남았다. 사람이 새로고침해 손으로 마감하기 전엔 영원히 그대로였다.
 *
 * - ended_at = 좌석의 마지막 하트비트(= HQ 가 마지막으로 살아 있던 시각). 좌석 행이 이미
 *   지워졌으면(정상 로그아웃) 알 길이 없어 now() — 그래도 시작보다 앞서진 않게 GREATEST.
 * - resolution 은 건드리지 않는다 → 끝났는데 내용 없는 "미기록" 상태가 되고, HQ 의
 *   [나중에]와 똑같이 지원기록에서 나중에 채울 수 있다. 자동 마감이라고 따로 표시하지 않는 건
 *   기록이 없다는 사실이 이미 화면에 있어서다.
 * - 시작 2분 미만은 건너뛴다 — 로그인 직후 좌석 행과 세션 생성 사이의 경합에 대한 안전 여유.
 * - 좌석이 살아 있어도 **12시간**을 넘긴 세션은 닫는다(2026-08-16 A5): 시작 직후 창을 닫아
 *   클라이언트가 sessionId 를 놓친 경우, 좌석만 보는 규칙으로는 영영 안 닫혔다.
 * - 읽는 자리(진행 중 표시가 나가는 조회들)에서 매번 호출한다. 열린 세션이 몇 개 없어
 *   UPDATE 비용은 무시할 수준이고, 별도 크론이 없는 Next.js 에선 이게 가장 정직한 자리다.
 * - 나중에 HQ 가 뒤늦게 /end 를 보내와도 endSession 의 COALESCE 가 여기서 박은 ended_at 을
 *   지키고 내용만 보강한다.
 *
 * @returns 닫은 세션 수
 */
export async function closeOrphanSessions(tenantId: string): Promise<number> {
  const result = await db.execute(sql`
    UPDATE support_sessions s
       SET ended_at = GREATEST(
             s.started_at,
             COALESCE(
               (SELECT a.last_seen_at FROM active_login_sessions a
                 WHERE a.user_id = s.operator_id),
               now()))
     WHERE s.tenant_id = ${tenantId}::uuid
       AND s.ended_at IS NULL
       AND s.started_at < now() - interval '2 minutes'
       AND (
         -- ① HQ 가 죽었다: 좌석 하트비트가 끊겼으면 그 앱도 원격 창도 없다.
         NOT EXISTS (
           SELECT 1 FROM active_login_sessions a
            WHERE a.user_id = s.operator_id
              AND a.last_seen_at > now() - interval '2 minutes')
         -- ② HQ 는 살아 있는데 세션만 고아가 됐다(2026-08-16 감사 A5).
         --    원격 시작 직후(<3초) 창을 닫으면 클라이언트가 sessionId 를 못 받고 놓치는데
         --    서버엔 행이 남는다. ①은 좌석만 보므로 HQ 를 켜 둔 동안 영원히 안 닫혔다.
         --    실제 A/S 는 길어야 수십 분이라 12시간이면 "사람이 끝냈는데 보고가 유실된 것"으로
         --    보는 게 맞다. 진짜 장시간 세션을 자르는 위험보다, 빨간 '지원 중'이 며칠 남아
         --    지원기록을 못 믿게 되는 쪽이 크다.
         OR s.started_at < now() - interval '12 hours'
       )
    RETURNING s.id
  `);
  return (result as unknown as { rows: unknown[] }).rows.length;
}

/**
 * 아직 안 끝난(endedAt 없음) 세션 목록 — 테넌트 전체 presence 표시용.
 * "재성이가 진희씨컴 접속 중" 같은 UI.
 */
export async function listActiveSessions(tenantId: string) {
  await closeOrphanSessions(tenantId);
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
  // 접속 기기 스탬프(마이그046) — 이 직원이 지금 앉아 있는 좌석의 호스트명·IP 를 복사한다.
  //   좌석은 계정당 한 줄이라 다음 로그인에 덮어써지므로, 세션마다 그때의 값을 남겨야
  //   나중에 "어느 PC 에서 봤나"를 답할 수 있다. HQ 는 아무것도 더 안 보낸다(발행 불필요).
  //   좌석이 없으면(옛 경로 로그인) null — 스탬프가 없다고 세션 기록을 막지는 않는다.
  const [seat] = await db
    .select({
      label: activeLoginSessions.deviceLabel,
      ip: activeLoginSessions.ip,
    })
    .from(activeLoginSessions)
    .where(eq(activeLoginSessions.userId, input.operatorId))
    .limit(1);
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
      operatorDevice: seat?.label ?? null,
      operatorIp: seat?.ip ?? null,
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
  /** 직결(P2P)이었나 릴레이였나(마이그038). 연결 수립 뒤에야 정해져 종료 보고에 실려 온다. */
  connDirect?: boolean;
  /** 예약 원격 창으로 **수락 없이** 들어갔나(마이그049). 거래처가 접속 시 알려 준 사실. */
  viaSchedWindow?: boolean;
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
      // 한 번 기록되면 유지 — 내용 보강 저장(두 번째 호출)엔 안 실려 오므로 덮어쓰지 않는다.
      ...(typeof fields?.connDirect === "boolean"
        ? { connDirect: fields.connDirect }
        : {}),
    })
    .where(
      and(eq(supportSessions.id, sessionId), eq(supportSessions.tenantId, tenantId)),
    );
}

/**
 * 아주 짧은 오접속(모달도 안 뜬 <15초) 삭제 — HQ 전용. 노이즈 이력 방지.
 * ★규칙(2026-08-15 Chang): **15초 미만 원격은 기록을 남기지 않는다.** 이건 정말 지운다.
 *   15초 이상은 어떤 경우에도 지우지 않는다 — 패널의 [기록 폐기]는 아래 discardSessionSoft.
 */
export async function discardSession(sessionId: string, tenantId: string): Promise<void> {
  await db
    .delete(supportSessions)
    .where(
      and(eq(supportSessions.id, sessionId), eq(supportSessions.tenantId, tenantId)),
    );
}

/**
 * 패널 [기록 폐기] — 지우지 않고 폐기 표식만(마이그045). 기본 목록에선 숨고 "폐기 포함"으로
 * 볼 수 있다. 진행 중이던 세션이면 지금 시각으로 끝낸다(활성 표시가 남지 않게).
 * 왜 삭제가 아닌가: 대리점과 분쟁이 나면 "누가 언제 어디를 원격했나"는 15초 이상이면
 * 반드시 찾을 수 있어야 한다. 폐기는 사람이 잘못 누른 A/S 기록을 치우는 것이지 접속 사실을
 * 없애는 게 아니다.
 */
export async function discardSessionSoft(sessionId: string, tenantId: string): Promise<void> {
  await db
    .update(supportSessions)
    .set({
      discardedAt: sql`now()`,
      endedAt: sql`COALESCE(${supportSessions.endedAt}, now())`,
    })
    .where(
      and(eq(supportSessions.id, sessionId), eq(supportSessions.tenantId, tenantId)),
    );
}

/** 폐기 취소 — 잘못 폐기한 기록을 되살린다. */
export async function restoreSession(sessionId: string, tenantId: string): Promise<void> {
  await db
    .update(supportSessions)
    .set({ discardedAt: null })
    .where(
      and(eq(supportSessions.id, sessionId), eq(supportSessions.tenantId, tenantId)),
    );
}

export type SessionRecordFields = {
  issueType?: "config" | "hardware" | "software" | "network" | "training" | "other" | null;
  resolution?: "resolved" | "pending" | "escalated" | "in_progress" | null;
  contactName?: string | null;
  categories?: string | null;
  description?: string | null;
};

/**
 * 사후 편집 — 패널 지원기록의 [기록 편집]. 끝났든 미기록이든 폐기됐든 내용을 채우거나 고친다.
 * 시간(started/ended)은 여기서 안 건드린다 — 원격 시간은 사실 기록이라 편집 대상이 아니다.
 * undefined = 그대로, null/빈문자 = 비움.
 */
export async function updateSessionRecord(
  sessionId: string,
  tenantId: string,
  f: SessionRecordFields,
): Promise<void> {
  const norm = (v: string | null | undefined) =>
    v === undefined ? undefined : v?.trim() ? v.trim() : null;
  await db
    .update(supportSessions)
    .set({
      ...(f.issueType !== undefined ? { issueType: f.issueType } : {}),
      ...(f.resolution !== undefined ? { resolution: f.resolution } : {}),
      ...(f.contactName !== undefined ? { contactName: norm(f.contactName) } : {}),
      ...(f.categories !== undefined ? { categories: norm(f.categories) } : {}),
      ...(f.description !== undefined ? { description: norm(f.description) } : {}),
    })
    .where(
      and(eq(supportSessions.id, sessionId), eq(supportSessions.tenantId, tenantId)),
    );
}

/**
 * 수동 기록 추가 — 원격 없이 손으로 남기는 A/S(전화 처리, 실수로 지운 기록 복원).
 * manual=true 로 표시돼 원격 세션과 구분된다. 시작·종료 시각은 사람이 준 값 그대로.
 */
export async function createManualSession(input: {
  tenantId: string;
  operatorId: string;
  customerId: string;
  startedAt: Date;
  endedAt: Date;
  fields?: SessionRecordFields;
}) {
  if (!(input.endedAt.getTime() >= input.startedAt.getTime()))
    throw new Error("종료 시각이 시작보다 앞섭니다");
  const [cust] = await db
    .select({ id: customers.id, remoteId: customers.remoteId })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, input.tenantId)))
    .limit(1);
  if (!cust) throw new Error("거래처가 없습니다");
  const f = input.fields ?? {};
  const norm = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
  const [row] = await db
    .insert(supportSessions)
    .values({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      customerId: cust.id,
      remoteId: cust.remoteId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      manual: true,
      issueType: f.issueType ?? null,
      resolution: f.resolution ?? "resolved",
      contactName: norm(f.contactName),
      categories: norm(f.categories),
      description: norm(f.description),
    })
    .returning();
  return row;
}

/** 거래처별 지원 이력 — HQ 거래처 카드 "지원이력" + 상세. 최신순. */
export async function listCustomerSessions(
  customerId: string,
  tenantId: string,
  limit = 100,
) {
  await closeOrphanSessions(tenantId);
  return db
    .select({ session: supportSessions, operatorName: users.displayName })
    .from(supportSessions)
    .leftJoin(users, eq(users.id, supportSessions.operatorId))
    .where(
      and(
        eq(supportSessions.customerId, customerId),
        eq(supportSessions.tenantId, tenantId),
        isNull(supportSessions.discardedAt),
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
  await closeOrphanSessions(tenantId);
  const conds = [
    eq(supportSessions.tenantId, tenantId),
    isNull(supportSessions.discardedAt),
  ];
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

// ────────────────────────────────────────────────────────────────────────────
// 패널 지원기록 조회 — 기간·거래처·검색어.
//
// ★페이지(app/sessions/page.tsx)에 인라인으로 두지 않고 여기 둔다. 테넌트 격리가
//   걸린 쿼리라 조용히 깨지면 남의 회사 기록이 보인다 — 테스트가 닿을 수 있는 자리에
//   있어야 한다(test/adv-session-search.test.ts 가 이 함수를 직접 친다).
// ────────────────────────────────────────────────────────────────────────────

export type SessionPeriod = "thisMonth" | "week" | "month" | "all";

const PERIOD_DAYS: Record<SessionPeriod, number> = {
  thisMonth: 0, // date_trunc 로 계산 — 아래 참조
  week: 7,
  month: 30,
  all: 0,
};

/** 기간·거래처·검색어 조건을 만든다. 세는 것과 목록을 뽑는 것이 같은 조건을 쓰도록 분리. */
function searchConds(opts: {
  tenantId: string;
  period: SessionPeriod;
  customerId?: string | null;
  q?: string | null;
  /** 폐기된 기록도 포함(마이그045). 기본은 숨김. */
  includeDiscarded?: boolean;
}) {
  const conds = [eq(supportSessions.tenantId, opts.tenantId)];
  if (!opts.includeDiscarded) conds.push(isNull(supportSessions.discardedAt));
  if (opts.period === "thisMonth") {
    // 대시보드 "이번 달 지원" 카드와 100% 같은 숫자가 나오도록 동일 식.
    conds.push(gte(supportSessions.startedAt, sql`date_trunc('month', now())`));
  } else if (opts.period !== "all") {
    const since = new Date(Date.now() - PERIOD_DAYS[opts.period] * 86400_000);
    conds.push(gte(supportSessions.startedAt, since));
  }
  if (opts.customerId) conds.push(eq(supportSessions.customerId, opts.customerId));

  const q = (opts.q ?? "").trim().slice(0, 60);
  if (q) {
    // 사람이 기억하는 건 대개 "누구네 무슨 증상"이라 이 넷이면 충분하다.
    //   ilike = 대소문자 무시(영문 상호 okpos 등). 값은 drizzle 이 파라미터로 넘기므로
    //   SQL 주입이 안 된다 — 문자열로 조립하지 말 것.
    const like = `%${q}%`;
    conds.push(
      or(
        ilike(supportSessions.description, like),
        ilike(customers.name, like),
        ilike(supportSessions.contactName, like),
        ilike(users.displayName, like),
      )!,
    );
  }
  return conds;
}

/** 패널 지원기록 목록. limit 상한을 넘으면 화면이 "이게 전부"로 읽히므로 호출부가 알린다. */
export async function searchSessions(opts: {
  tenantId: string;
  period: SessionPeriod;
  customerId?: string | null;
  q?: string | null;
  includeDiscarded?: boolean;
  limit?: number;
}) {
  await closeOrphanSessions(opts.tenantId);
  return db
    .select({
      id: supportSessions.id,
      discardedAt: supportSessions.discardedAt,
      manual: supportSessions.manual,
      customerId: supportSessions.customerId,
      customerName: customers.name,
      startedAt: supportSessions.startedAt,
      endedAt: supportSessions.endedAt,
      durationSec: supportSessions.durationSec,
      issueType: supportSessions.issueType,
      resolution: supportSessions.resolution,
      description: supportSessions.description,
      categories: supportSessions.categories,
      contactName: supportSessions.contactName,
      remoteId: supportSessions.remoteId,
      // 예약 원격 창으로 수락 없이 들어간 접속(마이그049) — 목록에 배지로 표시한다.
      viaSchedWindow: supportSessions.viaSchedWindow,
      operatorName: users.displayName,
      operatorDevice: supportSessions.operatorDevice,
      operatorIp: supportSessions.operatorIp,
    })
    .from(supportSessions)
    .leftJoin(customers, eq(customers.id, supportSessions.customerId))
    .leftJoin(users, eq(users.id, supportSessions.operatorId))
    .where(and(...searchConds(opts)))
    .orderBy(desc(supportSessions.startedAt))
    .limit(opts.limit ?? 200);
}

/** 같은 검색어를 기간 제한 없이 세어 본다. "기간 밖에 N건" 안내용. */
export async function countSessionsAllPeriods(opts: {
  tenantId: string;
  customerId?: string | null;
  q?: string | null;
  includeDiscarded?: boolean;
}) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(supportSessions)
    .leftJoin(customers, eq(customers.id, supportSessions.customerId))
    .leftJoin(users, eq(users.id, supportSessions.operatorId))
    .where(and(...searchConds({ ...opts, period: "all" })));
  return row?.n ?? 0;
}
