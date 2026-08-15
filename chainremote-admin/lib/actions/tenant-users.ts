"use server";

// 다른 tenant 의 직원(아이디) 관리 — super_admin(Chang) 전용.
//
// users.ts 는 me.tenantId 로 자기 회사에 격리돼 다른 회사 사용자를 못 건드린다.
// 여기선 super_admin 이 회사 상세 페이지에서 고른 tenantId 안에서만 동작하며,
// 모든 쿼리 WHERE 에 그 tenantId 를 강제해 엉뚱한 회사를 건드리지 못하게 한다.

import { db } from "@/lib/db";
import { revokeSeat } from "@/lib/data/active-sessions";
import { users } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { requireLiveUserOrThrow } from "@/lib/auth-guard";
import { assertEmailAvailable } from "@/lib/data/users";

const BCRYPT_COST = 10;
type Role = "owner" | "admin" | "operator" | "viewer";

async function requireSuperAdmin() {
  // 쿠키의 존재가 아니라 **계정이 지금도 살아 있는지**를 본다(퇴사자 즉시 차단).
  //   role 도 DB 현재값이라 권한 강등이 다음 클릭부터 바로 먹는다.
  const session = { user: await requireLiveUserOrThrow() };
  if (session.user.role !== "super_admin") {
    throw new Error("플랫폼 운영자(super_admin) 만 회사별 사용자 관리 가능");
  }
  return session.user;
}

function parseRole(v: unknown): Role {
  const r = String(v ?? "operator");
  if (r === "owner" || r === "admin" || r === "operator" || r === "viewer") {
    return r;
  }
  throw new Error("잘못된 역할");
}

function revalidate(tenantId: string) {
  revalidatePath("/users");
  revalidatePath(`/admin/tenants/${tenantId}/edit`);
}

export async function adminCreateUser(tenantId: string, formData: FormData) {
  await requireSuperAdmin();
  const email = String(formData.get("email") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = parseRole(formData.get("role"));

  if (!email) throw new Error("아이디 필수");
  if (!displayName) throw new Error("이름 필수");
  if (!password || password.length < 4) throw new Error("비번 4자 이상");

  await assertEmailAvailable(email); // 전역 email 중복 사전검사 (최종 방어는 마이그 012 유니크)
  const passwordHash = bcrypt.hashSync(password, BCRYPT_COST);
  await db.insert(users).values({
    tenantId,
    email,
    displayName,
    passwordHash,
    role,
    isActive: true,
  });
  revalidate(tenantId);
}

// "사용자" 탭(전체)에서 회사를 골라 추가 — tenantId 를 폼에서 받음.
export async function adminCreateUserGlobal(formData: FormData) {
  await requireSuperAdmin();
  const tenantId = String(formData.get("tenantId") ?? "").trim();
  if (!tenantId) throw new Error("회사 선택 필수");
  const email = String(formData.get("email") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = parseRole(formData.get("role"));
  if (!email) throw new Error("아이디 필수");
  if (!displayName) throw new Error("이름 필수");
  if (!password || password.length < 4) throw new Error("비번 4자 이상");

  await assertEmailAvailable(email); // 전역 email 중복 사전검사 (최종 방어는 마이그 012 유니크)
  const passwordHash = bcrypt.hashSync(password, BCRYPT_COST);
  await db.insert(users).values({
    tenantId,
    email,
    displayName,
    passwordHash,
    role,
    isActive: true,
  });
  revalidatePath("/users");
}

export async function adminUpdateUser(
  tenantId: string,
  userId: string,
  formData: FormData,
) {
  await requireSuperAdmin();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const role = parseRole(formData.get("role"));
  const isActive = formData.get("isActive") === "on";
  if (!displayName) throw new Error("이름 필수");

  await db
    .update(users)
    .set({ displayName, role, isActive, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  // 비활성이면 좌석도 회수(A2-10) — lib/actions/users.ts 의 같은 처리와 짝. 없으면 좌석 행이
  //   orphan TTL 2분까지 남아 그동안 대리점 동시접속 총량을 한 자리 잡아먹는다.
  if (!isActive) await revokeSeat(userId);
  revalidate(tenantId);
}

export async function adminResetUserPassword(
  tenantId: string,
  userId: string,
  formData: FormData,
) {
  await requireSuperAdmin();
  const newPassword = String(formData.get("newPassword") ?? "");
  if (!newPassword || newPassword.length < 4) {
    throw new Error("새 비번 4자 이상");
  }
  const passwordHash = bcrypt.hashSync(newPassword, BCRYPT_COST);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  // 비번을 바꾸면 기존 세션도 끊는다(A2-04, 2026-08-16). 종전엔 해시만 갈아서, 계정이
  //   털려 비번을 바꿔도 침입자 HQ 는 heartbeat 200 + 롤링 재발급으로 앱을 안 끄는 한
  //   영구히 살아 있었고 좌석까지 물고 있어 정당한 사용자가 409 를 맞았다.
  //   좌석을 비우면 그 HQ 는 ~5초 뒤 REVOKED 로 스스로 로그아웃한다.
  await revokeSeat(userId);
  revalidate(tenantId);
}

export async function adminDeleteUser(tenantId: string, userId: string) {
  await requireSuperAdmin();

  // 회사의 마지막 오너는 삭제 막음 — 지우면 그 회사에 로그인할 계정이 사라짐.
  const target = (
    await db
      .select({ role: users.role })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)))
      .limit(1)
  )[0];
  if (!target) throw new Error("해당 회사의 사용자가 아닙니다");
  if (target.role === "owner") {
    const owners = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "owner")));
    if (owners.length <= 1) {
      throw new Error("회사의 마지막 오너는 삭제할 수 없습니다 (다른 오너 지정 후 삭제)");
    }
  }

  await db
    .delete(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  revalidate(tenantId);
}
