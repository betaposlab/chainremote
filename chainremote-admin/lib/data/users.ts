// 사용자 데이터 헬퍼.
import { sql, and, eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

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
