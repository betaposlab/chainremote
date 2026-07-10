"use server";

// 신규 회사(tenant) 등록 + owner 1명 자동 생성. 사업화 1단계.
// 전 액션 super_admin(Chang) 전용 — 다른 tenant 데이터는 조회조차 안 한다.
// Chang 의 책임은 tenant 라이프사이클(생성/요금 변경/정지/비번 리셋)에 한정.

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  createTenantWithOwner,
  deleteTenantCascade,
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

// Web Crypto 기반 임시 비번. charset 길이 초과분은 버리며 한 글자씩 뽑는다.
function generateTempPassword(): string {
  const buf = new Uint8Array(PASSWORD_LEN * 2);
  globalThis.crypto.getRandomValues(buf);
  let out = "";
  let i = 0;
  for (const b of buf) {
    if (out.length >= PASSWORD_LEN) break;
    // 256 % charset 의 modulo bias 는 charset>=32 에선 무시할 수준.
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

  // 비번은 폼 입력값 우선, 비어있으면 '1234'. 대리점이 첫 로그인 후 바꾸는 전제.
  // (random 발급 함수는 비번 분실 리셋 때만 쓴다.)
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

// 비번 분실 시 owner 비번을 '1234' 로 강제 재설정. 신규 등록 default 와 같은 정책.
// (사용자가 첫 로그인 후 직접 바꾸는 게 표준. random 발급 함수는 정책 변경 대비 보존.)
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

// 회사(대리점) 완전 삭제 — super_admin 전용, 소속 사용자·거래처 전부 cascade 삭제(되돌리기 불가).
//   ★결과를 {ok/error}로 반환한다(throw 아님): Next.js 프로덕션은 throw 된 에러 메시지를 가려
//   digest 만 노출하므로, 클라이언트가 친절히 보여주려면 값으로 돌려줘야 한다.
//   ★자기 회사(운영사 betaposlab) 삭제 금지: 지우면 Chang 이 로그인 불가 + 본업 데이터 증발.
export async function deleteTenant(
  id: string,
): Promise<{ ok: boolean; error?: string; deletedCustomers?: number }> {
  const me = await requireSuperAdmin();
  if (id === me.tenantId) {
    return { ok: false, error: "본인 소속 회사(운영사)는 삭제할 수 없습니다." };
  }
  const t = await getTenant(id);
  if (!t) return { ok: false, error: "이미 삭제된 회사입니다." };
  const { deletedCustomers } = await deleteTenantCascade(id);
  revalidatePath("/admin/tenants");
  revalidatePath("/users");
  return { ok: true, deletedCustomers };
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

// 구독 상태 변경 (active/suspended/cancelled).
// TODO: suspended 회사의 사용자 로그인 차단 가드는 아직 없음.
export async function setSubscriptionStatus(
  id: string,
  status: "active" | "suspended" | "cancelled",
) {
  await requireSuperAdmin();
  await setTenantSubscriptionStatus(id, status);
  revalidatePath("/admin/tenants");
}

// auto-enroll: 이 대리점 전용 enroll-key 발급/재발급. 거래처 agent 가 설치 시
// 이 키로 소속을 증명해 자가등록한다. 평문 키는 반환값으로 1회만 노출(UI 표시),
// DB 엔 sha-256 해시만. custom.txt 는 이 키가 박힌 대리점 전용 인스톨러 빌드 입력값.
//
// 해싱은 resolveTenantByEnroll 의 대조 해시와 반드시 같은 함수(hashHeartbeatToken)를
// 써야 한다 — 어긋나면 enroll 전부 403. 재발급하면 옛 키 인스톨러는 신규등록 불가(403)지만,
// 이미 등록된 거래처는 heartbeat-token 기반이라 무영향(UI 가 경고).
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
  // 해시(검증용) + 암호화 평문(재다운로드용) 함께 저장.
  const enrollKey = await reissueEnrollKey(tenantId);

  // betaposlab 루트 custom-agent.txt 와 같은 포맷.
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
