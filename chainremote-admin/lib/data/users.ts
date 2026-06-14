// 사용자 데이터 헬퍼.
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

// C1: email 전역 유니크 사전검사 — 사용자에게 읽기 쉬운 에러를 주기 위함.
// 최종 방어선은 마이그레이션 012 의 unique index(lower(email)) — 사전검사~INSERT 사이 레이스에도
// DB 제약이 최종 차단한다. 대소문자 무시 전역(모든 tenant) 검사.
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
