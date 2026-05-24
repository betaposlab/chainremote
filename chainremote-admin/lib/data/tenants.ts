// Tenant 데이터 레이어 — Server Actions(super_admin UI) 가 호출.
// 데스크톱 앱은 자기 tenant 안만 다루므로 이 레이어 안 씀.
//
// 가드 없음 — 호출자(actions) 가 requireSuperAdmin() 후 호출 책임.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants, users } from "@/lib/schema";

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
