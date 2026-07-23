// 사용자 데이터 헬퍼.
import { sql, and, asc, count, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, tenants } from "@/lib/schema";

/**
 * 좌석 상한 검사 — 활성 아이디(=동시 세션) 수가 대리점 max_seats 를 넘지 않게 강제.
 * "1 아이디 = 동시 1세션"(마이그 010)과 짝. 아이디 무제한 생성으로 과금이 새는 걸 막는다.
 * excludeUserId 를 주면 그 아이디를 뺀 활성 수로 센다(비활성→활성 전환 검사용).
 * 본사(super_admin 대리점)는 max_seats=9999 라 자연히 통과 — 별도 예외 불필요.
 * 초과면 throw. (마이그 027 / 2026-07-23 Chang 과금 구멍 지적)
 */
export async function assertSeatAvailable(
  tenantId: string,
  excludeUserId?: string,
): Promise<void> {
  const [t] = await db
    .select({ maxSeats: tenants.maxSeats })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const maxSeats = t?.maxSeats ?? 1;
  const conds = [eq(users.tenantId, tenantId), eq(users.isActive, true)];
  if (excludeUserId) conds.push(ne(users.id, excludeUserId));
  const [{ used }] = await db
    .select({ used: count() })
    .from(users)
    .where(and(...conds));
  if (used >= maxSeats) {
    throw new Error(
      `좌석이 부족합니다 (사용 ${used} / 보유 ${maxSeats}석). 좌석을 추가 구매하려면 문의하세요.`,
    );
  }
}

// 거래처 담당 배정 드롭다운용 — 이 테넌트의 활성 직원 목록.
export async function listTenantStaff(tenantId: string) {
  return db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)))
    .orderBy(asc(users.displayName));
}

// email 전역 유니크 사전검사 — 읽기 쉬운 에러를 주기 위한 것일 뿐, 최종 방어선은
// 마이그 012 의 unique index(lower(email)) 다. 사전검사~INSERT 레이스는 그 제약이 막는다.
// 대소문자 무시, 모든 tenant 대상.
export async function assertEmailAvailable(email: string): Promise<void> {
  const norm = email.trim().toLowerCase();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${norm}`)
    .limit(1);
  if (existing.length > 0) {
    throw new Error("이미 사용 중인 아이디입니다. 다른 아이디(email)를 사용하세요.");
  }
}
