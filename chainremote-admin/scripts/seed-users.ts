// 초기 사용자 시드 — chang (owner) + jaesung (admin), 비번 6002
//
// 실행: `cd chainremote-admin && npx tsx scripts/seed-users.ts`
// 정책: 같은 email (= 로그인 ID) 이 이미 있으면 skip (idempotent).
//       기존 거래처들은 assigned_user_id 가 NULL 이면 chang 으로 설정.
//
// 비번 변경은 추후 /users 페이지에서 owner 가 리셋.

import bcrypt from "bcryptjs";
import { db } from "../lib/db";
import { tenants, users, customers } from "../lib/schema";
import { eq, and, isNull } from "drizzle-orm";

const TENANT_SLUG = "betaposlab";
const INITIAL_PASSWORD = "6002";

async function main() {
  // 1. 테넌트 찾기
  const tenantRows = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, TENANT_SLUG));
  if (tenantRows.length === 0) {
    throw new Error(`tenant "${TENANT_SLUG}" 없음 — 먼저 등록 필요`);
  }
  const tenantId = tenantRows[0].id;
  console.log(`tenant: ${tenantRows[0].displayName} (${tenantId})`);

  // 2. 비번 해싱 (매 실행마다 다른 salt — 운영상 문제 없음)
  const passwordHash = bcrypt.hashSync(INITIAL_PASSWORD, 10);

  // 3. 사용자 2명 upsert
  const seedUsers: Array<{
    email: string;
    displayName: string;
    role: "owner" | "admin";
  }> = [
    { email: "chang", displayName: "김창현", role: "owner" },
    { email: "jaesung", displayName: "이재성", role: "admin" },
  ];

  for (const u of seedUsers) {
    const existing = await db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, u.email)));
    if (existing.length > 0) {
      console.log(`  skip: ${u.email} 이미 존재 (id=${existing[0].id})`);
      continue;
    }
    const inserted = await db
      .insert(users)
      .values({
        tenantId,
        email: u.email,
        passwordHash,
        displayName: u.displayName,
        role: u.role,
        isActive: true,
      })
      .returning();
    console.log(`  생성: ${u.email} (${u.role}) → ${inserted[0].id}`);
  }

  // 4. chang 의 id 다시 조회 (담당자 배정용)
  const changRow = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, "chang")));
  if (changRow.length === 0) throw new Error("chang 생성 실패");
  const changId = changRow[0].id;

  // 5. 담당자 미지정 거래처를 chang 으로 일괄 배정
  const updated = await db
    .update(customers)
    .set({ assignedUserId: changId })
    .where(and(eq(customers.tenantId, tenantId), isNull(customers.assignedUserId)))
    .returning();
  console.log(`  거래처 ${updated.length} 건 chang 으로 담당자 배정`);

  console.log("\n=== 시드 완료 ===");
  console.log(`  로그인: chang / jaesung`);
  console.log(`  초기 비번: ${INITIAL_PASSWORD}`);
  console.log(`  /users 페이지에서 추후 비번 리셋 가능`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
