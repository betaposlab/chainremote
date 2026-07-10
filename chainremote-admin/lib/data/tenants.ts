// Tenant 데이터 레이어 — super_admin UI 의 Server Actions 가 호출한다.
// 데스크톱 앱은 자기 tenant 안만 보므로 이 레이어를 안 쓴다.
//
// 여기엔 가드가 없다 — 호출자(actions)가 requireSuperAdmin() 를 먼저 통과할 책임.

import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants, users, customers } from "@/lib/schema";
import { assertEmailAvailable } from "./users";
import { generateHeartbeatToken, hashHeartbeatToken } from "@/lib/heartbeat-token";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";

// 회사 생성 때 함께 받는 사업자/연락처/구독 정보. 모두 옵셔널 — 필수 검증은 폼이
// 하고 DB 는 nullable. monthly_fee_krw 는 공급가액(부가세 별도).
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

// 신규 회사 + 그 회사 owner 1명을 한 트랜잭션으로 생성.
// 반환: 새 tenant + admin user (UI 가 다운로드 URL/임시비번 보여줄 때 쓴다).
export async function createTenantWithOwner(args: {
  tenant: TenantFields;
  admin: { email: string; displayName: string; passwordHash: string };
}) {
  // 전역 email 중복 사전검사 (친절한 에러용). 최종 방어는 마이그 012 unique index(lower(email)).
  await assertEmailAvailable(args.admin.email);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .insert(tenants)
      .values({
        ...args.tenant,
        plan: "free", // plan 컬럼은 사실상 deprecated — 실제 요금은 monthlyFeeKrw
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

// 정지/해지 테넌트 차단용 — 로그인/heartbeat 가 호출.
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

/**
 * 회사(tenant) 완전 삭제. 소속 사용자·거래처·즐겨찾기·세션·pending_updates 는 스키마의
 * tenant_id FK(onDelete: cascade)로 DB 가 자동 정리한다(schema.ts 89/110/178/196/223).
 * 되돌릴 수 없다 — 호출 전 권한/자기회사 가드는 action 레이어(deleteTenant)가 책임진다.
 * 삭제된 거래처 수를 반환해 UI 가 "N개 거래처와 함께 삭제됨" 을 보여줄 수 있게 한다.
 */
export async function deleteTenantCascade(
  id: string,
): Promise<{ deletedCustomers: number }> {
  const [{ value: deletedCustomers }] = await db
    .select({ value: count() })
    .from(customers)
    .where(eq(customers.tenantId, id));
  await db.delete(tenants).where(eq(tenants.id, id));
  return { deletedCustomers };
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

// auto-enroll — 그 tenant 의 enroll-key sha-256 해시만 저장(평문은 절대 안 넣는다).
// 호출자가 requireSuperAdmin() 후 사용. 재호출 = 키 회전 — 옛 키로 만든 인스톨러는
// 신규 등록 불가, 이미 등록된 거래처는 토큰 기반이라 영향 없다.
export async function setEnrollSecretHash(tenantId: string, hash: string) {
  await db
    .update(tenants)
    .set({ enrollSecretHash: hash, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
}

// enroll-key 발급/재발급 — 새 랜덤 생성 후 해시(검증)+암호화평문(재다운로드)을 함께 저장하고
// 평문을 반환. 재발급 = 옛 키 무효화 (기존 등록 거래처는 토큰 기반이라 영향 없음).
export async function reissueEnrollKey(tenantId: string): Promise<string> {
  const key = generateHeartbeatToken();
  await db
    .update(tenants)
    .set({
      enrollSecretHash: hashHeartbeatToken(key),
      enrollSecretEnc: encryptSecret(key),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
  return key;
}

// 스테이블 enroll-key — 암호화 평문이 있으면 복호화해 같은 키를 돌려준다(재다운로드해도
// 같은 .exe). 없으면(신규/백필 전) 새로 발급. 다운로드 경로가 이걸 써서 키가 안 흔들린다.
export async function getOrCreateEnrollKey(tenantId: string): Promise<string> {
  const [t] = await db
    .select({ enc: tenants.enrollSecretEnc })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (t?.enc) {
    try {
      return decryptSecret(t.enc);
    } catch {
      // enc 손상/AUTH_SECRET 불일치 — 재발급으로 폴백.
    }
  }
  return reissueEnrollKey(tenantId);
}

// 특정 tenant 의 owner user 비번 강제 재설정 (super_admin 만).
// 호출자가 requireSuperAdmin() 후 사용. 반환은 hash 가 아니라 새 평문 비번 —
// 화면에 띄우고 Chang 이 카톡으로 회사에 전달.
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

// 특정 회사의 직원(아이디) 목록 — super_admin 회사 상세에서 사용.
// 호출자가 requireSuperAdmin() 후 사용.
export async function listTenantUsers(tenantId: string) {
  return db
    .select()
    .from(users)
    .where(eq(users.tenantId, tenantId))
    .orderBy(desc(users.createdAt));
}

// 전체 사용자 + 소속 회사 — super_admin "사용자" 탭(회사 무관 전체 조회).
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
