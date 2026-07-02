"use server";

// 다른 tenant 의 직원(아이디) 관리 — super_admin(Chang) 전용.
//
// users.ts 는 me.tenantId 로 자기 회사에 격리돼 다른 회사 사용자를 못 건드린다.
// 여기선 super_admin 이 회사 상세 페이지에서 고른 tenantId 안에서만 동작하며,
// 모든 쿼리 WHERE 에 그 tenantId 를 강제해 엉뚱한 회사를 건드리지 못하게 한다.

import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { assertEmailAvailable } from "@/lib/data/users";

const BCRYPT_COST = 10;
type Role = "owner" | "admin" | "operator" | "viewer";

async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
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
