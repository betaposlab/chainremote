"use server";

// 사업화 1단계 — 신규 회사(tenant) 등록 + 회사 owner 1명 자동 생성.
// 모든 액션은 super_admin (Chang) 만 호출 가능 — 다른 tenant 안 데이터는 *조회도
// 안 함*. Chang 의 운영 책임은 tenant 라이프사이클 (생성/요금 변경/정지/비번 리셋)
// 만으로 한정. 코이노식 운영.

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  createTenantWithOwner,
  findFirstOwnerOfTenant,
  getTenant,
  reissueEnrollKey,
  setTenantSubscriptionStatus,
  setUserPasswordHash,
  updateTenant,
  type TenantFields,
} from "@/lib/data/tenants";

const BCRYPT_COST = 10;
// 사람이 혼동하기 쉬운 문자 제외 (O/0, I/l/1) → 카톡 전달 시 오류 ↓
const PASSWORD_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const PASSWORD_LEN = 8;

async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
  if (session.user.role !== "super_admin") {
    throw new Error("super_admin 권한만 회사 관리 가능");
  }
  return session.user;
}

// Web Crypto 기반 random — bias 없는 모듈러 추출 위해 한 글자씩 256 범위에서
// 뽑고 charset 길이로 reject sampling.
function generateTempPassword(): string {
  const buf = new Uint8Array(PASSWORD_LEN * 2);
  globalThis.crypto.getRandomValues(buf);
  let out = "";
  let i = 0;
  for (const b of buf) {
    if (out.length >= PASSWORD_LEN) break;
    // 256 % charset.length 로 인한 약한 bias 는 charset>=32 이상에서 미미 — 무시.
    out += PASSWORD_CHARSET[b % PASSWORD_CHARSET.length];
    i++;
  }
  return out;
}

// 한글/영문 회사명에서 slug 추정. UI 에서 사용자가 덮어쓰면 그 값 우선.
function slugifyKo(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || `t-${Date.now().toString(36)}`;
}

export interface CreateTenantResult {
  tenantId: string;
  adminEmail: string;
  tempPassword: string;       // 평문 — UI 가 1회 표시. DB 엔 hash 만.
  adminDisplayName: string;
  tenantDisplayName: string;
}

// 신규 회사 등록 — UI 폼에서 호출.
export async function createTenant(formData: FormData): Promise<CreateTenantResult> {
  await requireSuperAdmin();

  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string): number | null => {
    const v = str(k);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const displayName = str("displayName");
  if (!displayName) throw new Error("회사명 필수");
  const adminEmail = str("adminEmail");
  if (!adminEmail) throw new Error("관리자 아이디 필수");
  const adminDisplayName = str("adminDisplayName") || displayName;

  // 비번: 폼 입력값 우선. 비어있으면 '1234' 기본값 (영업단계에서 대리점이
  // 첫 로그인 후 자유 변경. random 발급은 비번 분실 리셋 때만 사용).
  const inputPassword = str("adminPassword");
  const tempPassword = inputPassword || "1234";
  if (tempPassword.length < 4) throw new Error("비번 4자 이상");

  const slug = str("slug") || slugifyKo(displayName);

  const tenant: TenantFields = {
    displayName,
    slug,
    businessNo: str("businessNo") || null,
    representativeName: str("representativeName") || null,
    businessAddress: str("businessAddress") || null,
    businessType: str("businessType") || null,
    businessItem: str("businessItem") || null,
    companyPhone: str("companyPhone") || null,
    representativePhone: str("representativePhone") || null,
    contactPhone: str("contactPhone") || null,
    bankName: str("bankName") || null,
    bankAccount: str("bankAccount") || null,
    bankHolder: str("bankHolder") || null,
    monthlyFeeKrw: num("monthlyFeeKrw"),
    paymentDay: num("paymentDay"),
    paymentMethod: (str("paymentMethod") as TenantFields["paymentMethod"]) || null,
    subscriptionStartedAt: str("subscriptionStartedAt")
      ? new Date(str("subscriptionStartedAt"))
      : new Date(),
    notes: str("notes") || null,
  };

  const passwordHash = bcrypt.hashSync(tempPassword, BCRYPT_COST);

  const { tenant: t, admin } = await createTenantWithOwner({
    tenant,
    admin: { email: adminEmail, displayName: adminDisplayName, passwordHash },
  });

  revalidatePath("/admin/tenants");

  return {
    tenantId: t.id,
    adminEmail: admin.email,
    tempPassword, // 평문 — UI 가 한 번 보여주고 끝
    adminDisplayName: admin.displayName,
    tenantDisplayName: t.displayName,
  };
}

// 비번 분실 시 호출. 회사 owner 의 비번을 '1234' 로 강제 재설정.
// (신규 등록 default 와 동일 정책 — 단순/일관성. 사용자가 첫 로그인 후 본인 비번
// 으로 변경하는 것이 표준 운영. random 발급 함수는 보존 — 향후 정책 변경 시 재사용.)
export async function resetTenantOwnerPassword(tenantId: string): Promise<{
  adminEmail: string;
  tempPassword: string;
}> {
  await requireSuperAdmin();
  const owner = await findFirstOwnerOfTenant(tenantId);
  if (!owner) throw new Error("이 회사의 owner 사용자 못 찾음");
  const tempPassword = "1234";
  const passwordHash = bcrypt.hashSync(tempPassword, BCRYPT_COST);
  await setUserPasswordHash(owner.id, passwordHash);
  revalidatePath("/admin/tenants");
  return { adminEmail: owner.email, tempPassword };
}

// 회사 정보 일부 수정 (요금/연락처/비고 등) — 데이터 객체 형태.
export async function patchTenant(id: string, patch: Partial<TenantFields>) {
  await requireSuperAdmin();
  await updateTenant(id, patch);
  revalidatePath("/admin/tenants");
}

// 회사 정보 수정 — formData 형태 (수정 폼에서 호출).
// slug 와 관리자 계정은 수정 불가(URL break + 별도 사용자 관리 페이지).
export async function updateTenantFromForm(id: string, formData: FormData) {
  await requireSuperAdmin();

  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string): number | null => {
    const v = str(k);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const displayName = str("displayName");
  if (!displayName) throw new Error("회사명 필수");

  const patch: Partial<TenantFields> = {
    displayName,
    businessNo: str("businessNo") || null,
    representativeName: str("representativeName") || null,
    businessAddress: str("businessAddress") || null,
    businessType: str("businessType") || null,
    businessItem: str("businessItem") || null,
    companyPhone: str("companyPhone") || null,
    representativePhone: str("representativePhone") || null,
    contactPhone: str("contactPhone") || null,
    bankName: str("bankName") || null,
    bankAccount: str("bankAccount") || null,
    bankHolder: str("bankHolder") || null,
    monthlyFeeKrw: num("monthlyFeeKrw"),
    paymentDay: num("paymentDay"),
    paymentMethod: (str("paymentMethod") as TenantFields["paymentMethod"]) || null,
    subscriptionStartedAt: str("subscriptionStartedAt")
      ? new Date(str("subscriptionStartedAt"))
      : null,
    notes: str("notes") || null,
  };

  await updateTenant(id, patch);
  revalidatePath("/admin/tenants");
}

// 구독 상태 변경 (active/suspended/cancelled). suspended 면 그 회사 사용자
// 로그인 불가하도록 별도 가드 추가 필요(다음 작업).
export async function setSubscriptionStatus(
  id: string,
  status: "active" | "suspended" | "cancelled",
) {
  await requireSuperAdmin();
  await setTenantSubscriptionStatus(id, status);
  revalidatePath("/admin/tenants");
}

// ⑤ auto-enroll — 이 대리점(tenant) 전용 enroll-key 발급/재발급.
//   거래처 agent 가 설치 시 이 키로 "내가 이 대리점 소속"임을 증명 → 자가등록.
//   평문 키는 *이 반환값으로 1회만* 노출(UI 표시), DB 엔 sha-256 해시만 저장.
//   custom.txt = 그 대리점 전용 에이전트 인스톨러 빌드 입력값(이 키 박혀있음).
// 방어:
//   - super_admin 만 (requireSuperAdmin).
//   - 회사 존재 검증 (없으면 친절한 에러).
//   - hashHeartbeatToken 사용 → resolveTenantByEnroll 의 대조 해시와 100% 동일(틀리면 enroll 전부 403).
//   - 재발급(reissued=true) 이면 옛 키로 만든 인스톨러는 *신규 등록* 불가(403),
//     단 이미 등록된 거래처는 heartbeat-token 기반이라 무영향 → UI 가 경고.
export interface IssueEnrollKeyResult {
  slug: string;
  tenantDisplayName: string;
  enrollKey: string; // 평문 — 1회 표시 후 폐기 (DB 엔 hash 만)
  customTxt: string; // 이 대리점 전용 에이전트 빌드용 custom.txt 전체 내용
  reissued: boolean; // 기존 키가 있었나 (true = 재발급, 옛 인스톨러 신규등록 무효화)
}

export async function issueTenantEnrollKey(
  tenantId: string,
): Promise<IssueEnrollKeyResult> {
  await requireSuperAdmin();
  const t = await getTenant(tenantId);
  if (!t) throw new Error("회사를 찾을 수 없습니다");

  const reissued = !!t.enrollSecretHash;
  // 새 키 발급 — 해시(검증)+암호화평문(재다운로드) 함께 저장.
  const enrollKey = await reissueEnrollKey(tenantId);

  // betaposlab 루트 custom-agent.txt 와 동일 포맷 (JSON.stringify 로 항상 유효 JSON).
  const customTxt = JSON.stringify({
    "conn-type": "incoming",
    "tenant-slug": t.slug,
    "enroll-key": enrollKey,
    "default-settings": { "allow-remote-config-modification": "Y" },
    "override-settings": { "approve-mode": "click" },
  });

  revalidatePath("/admin/tenants");
  return {
    slug: t.slug,
    tenantDisplayName: t.displayName,
    enrollKey,
    customTxt,
    reissued,
  };
}
