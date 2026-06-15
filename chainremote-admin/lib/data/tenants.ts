// Tenant 데이터 레이어 — Server Actions(super_admin UI) 가 호출.
// 데스크톱 앱은 자기 tenant 안만 다루므로 이 레이어 안 씀.
//
// 가드 없음 — 호출자(actions) 가 requireSuperAdmin() 후 호출 책임.

import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants, users } from "@/lib/schema";
import { assertEmailAvailable } from "./users";

// 회사(tenant) 생성 시 함께 받는 사업자/연락처/구독 정보. 모두 옵셔널 — 일단
// 폼에서 필수 검증, DB 는 nullable. monthly_fee_krw 는 공급가액(부가세 별도).
export interface TenantFields {
  displayName: string;                            // 회사명
  slug: string;                                   // URL slug (영문, unique)
  businessNo?: string | null;
  representativeName?: string | null;
  businessAddress?: string | null;
  businessType?: string | null;
  businessItem?: string | null;
  companyPhone?: string | null;
  representativePhone?: string | null;
  contactPhone?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankHolder?: string | null;
  monthlyFeeKrw?: number | null;
  paymentDay?: number | null;                     // 1~31
  paymentMethod?: "cms" | "bank_transfer" | "credit_card" | null;
  subscriptionStartedAt?: Date | null;
  notes?: string | null;
}

// 신규 회사 + 그 회사의 owner 사용자 1명을 한 트랜잭션으로 생성.
// 반환: 새 tenant row + admin user row (UI 에서 다운로드 URL/임시비번 표시용).
export async function createTenantWithOwner(args: {
  tenant: TenantFields;
  admin: { email: string; displayName: string; passwordHash: string };
}) {
  // C1: 전역 email 중복 사전검사 (친절한 에러). 최종 방어는 마이그레이션 012 unique index(lower(email)).
  await assertEmailAvailable(args.admin.email);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .insert(tenants)
      .values({
        ...args.tenant,
        plan: "free", // 호환 — plan 컬럼은 사실상 deprecated, 실제 요금은 monthlyFeeKrw
      })
      .returning();
    const [u] = await tx
      .insert(users)
      .values({
        tenantId: t.id,
        email: args.admin.email,
        displayName: args.admin.displayName,
        passwordHash: args.admin.passwordHash,
        role: "owner", // 회사 내 최고 권한
        isActive: true,
      })
      .returning();
    return { tenant: t, admin: u };
  });
}

// H1: 정지/해지 테넌트 차단용 — 로그인/heartbeat 가 호출.
// is_active=true AND subscription_status='active' 만 통과. 미존재도 false.
export async function isTenantActive(tenantId: string): Promise<boolean> {
  const [t] = await db
    .select({
      isActive: tenants.isActive,
      subscriptionStatus: tenants.subscriptionStatus,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return !!t && t.isActive && t.subscriptionStatus === "active";
}

export async function listTenants() {
  return db.select().from(tenants).orderBy(desc(tenants.createdAt));
}

export async function getTenant(id: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateTenant(id: string, patch: Partial<TenantFields>) {
  await db
    .update(tenants)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tenants.id, id));
}

export async function setTenantSubscriptionStatus(
  id: string,
  status: "active" | "suspended" | "cancelled",
) {
  await db
    .update(tenants)
    .set({ subscriptionStatus: status, updatedAt: new Date() })
    .where(eq(tenants.id, id));
}

// 특정 tenant 의 owner user 비번 강제 재설정 (super_admin 만).
// 호출자가 requireSuperAdmin() 후 사용. 반환은 hash 가 아닌 새 *평문 비번* —
// 화면에 표시하고 Chang 이 카톡으로 회사에 전달.
export async function findFirstOwnerOfTenant(tenantId: string) {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "owner")))
    .limit(1);
  return rows[0] ?? null;
}

export async function setUserPasswordHash(userId: string, passwordHash: string) {
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// 특정 회사(tenant)의 직원(아이디) 목록 — super_admin 회사 상세에서 사용.
// 호출자가 requireSuperAdmin() 후 사용.
export async function listTenantUsers(tenantId: string) {
  return db
    .select()
    .from(users)
    .where(eq(users.tenantId, tenantId))
    .orderBy(desc(users.createdAt));
}

// 전체 사용자 + 소속 회사 — super_admin 의 "사용자" 탭(회사 무관 전체 조회).
export async function listAllUsersWithCompany() {
  return db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      lastVersion: users.lastVersion,
      lastHeartbeatAt: users.lastHeartbeatAt,
      tenantId: users.tenantId,
      companyName: tenants.displayName,
      companySlug: tenants.slug,
    })
    .from(users)
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .orderBy(desc(users.createdAt));
}

// 회사별 아이디(사용자) 수 — 회사 목록의 "아이디 N개" 컬럼.
export async function tenantUserCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ tenantId: users.tenantId, c: count() })
    .from(users)
    .groupBy(users.tenantId);
  const map: Record<string, number> = {};
  for (const r of rows) map[r.tenantId] = Number(r.c);
  return map;
}
