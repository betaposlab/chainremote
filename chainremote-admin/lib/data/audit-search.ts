// 감사 기록 조회 — 화면이 쓰는 유일한 통로.
//
// ★테넌트 격리가 걸린 쿼리다. 화면 파일 안에서 직접 짜면 테스트가 안 닿는 자리에
//   격리 조건이 놓인다. 지원기록(lib/data/sessions.ts)과 같은 이유로 여기 둔다 —
//   두 번째 사본을 만들지 말 것.
//
// super_admin 만 전 회사를 본다. owner·admin 은 자기 회사 것만. member 는 화면 자체가 없다.

import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, tenants, users } from "@/lib/schema";

export type AuditPeriod = "week" | "month" | "quarter" | "all";
export type AuditKind = "all" | "auth" | "change";

/** 로그인 계열과 변경 계열. 섞어 보면 로그인 소음에 변경 한 줄이 묻힌다. */
const AUTH_ACTIONS = ["auth.login", "auth.login_failed", "auth.takeover"];

export interface AuditRow {
  id: number;
  createdAt: Date;
  action: string;
  actorName: string | null;
  actorEmail: string | null;
  tenantName: string | null;
  targetType: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditQuery {
  /** null 이면 전 회사(super_admin 전용). 화면이 역할을 보고 정한다. */
  tenantId: string | null;
  period: AuditPeriod;
  kind: AuditKind;
  /** 아이디·이름·IP·시도한 아이디에서 찾는다. */
  q?: string;
  limit?: number;
}

function since(period: AuditPeriod): Date | null {
  if (period === "all") return null;
  const days = period === "week" ? 7 : period === "month" ? 30 : 90;
  return new Date(Date.now() - days * 86_400_000);
}

export async function searchAudit(p: AuditQuery): Promise<AuditRow[]> {
  const where: SQL[] = [];

  // ★격리. tenantId 가 있으면 그 회사 것만 — 화면에서 빼먹을 수 없게 여기서 강제한다.
  if (p.tenantId) where.push(eq(auditLogs.tenantId, p.tenantId));

  const from = since(p.period);
  if (from) where.push(gte(auditLogs.createdAt, from));

  if (p.kind === "auth") where.push(inArray(auditLogs.action, AUTH_ACTIONS));
  else if (p.kind === "change")
    where.push(notInArray(auditLogs.action, AUTH_ACTIONS));

  const q = (p.q ?? "").trim().slice(0, 60);
  if (q) {
    const like = `%${q}%`;
    const cond = or(
      ilike(users.email, like),
      ilike(users.displayName, like),
      // ★ip_address 는 DB 가 inet 이다(Drizzle 은 text 로 선언 — audit.ts 주석 참조).
      //   inet 에는 ILIKE 연산자가 없어 캐스팅 없이 쓰면 쿼리가 통째로 42883 으로 터진다.
      sql`${auditLogs.ipAddress}::text ILIKE ${like}`,
      // 없는 아이디로 친 시도는 사용자에 안 걸리므로 metadata 에서만 찾힌다.
      sql`${auditLogs.metadata}->>'attemptedId' ILIKE ${like}`,
    );
    if (cond) where.push(cond);
  }

  return db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      actorName: users.displayName,
      actorEmail: users.email,
      tenantName: tenants.displayName,
      targetType: auditLogs.targetType,
      metadata: auditLogs.metadata,
      ipAddress: auditLogs.ipAddress,
      userAgent: auditLogs.userAgent,
    })
    .from(auditLogs)
    // 행위자·회사는 지워졌을 수 있다(FK set null) — 그래도 기록은 남아야 하므로 left join.
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(p.limit ?? 300);
}
