"use server";

import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { assertEmailAvailable } from "@/lib/data/users";

async function requireOwner() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
  // super_admin(Chang)도 자기 tenant 의 owner 를 겸한다.
  // 다른 tenant 사용자는 me.tenantId 격리로 어차피 안 보인다.
  if (session.user.role !== "owner" && session.user.role !== "super_admin") {
    throw new Error("owner 권한만 사용자 관리 가능");
  }
  return session.user;
}

const BCRYPT_COST = 10;

export async function createUser(formData: FormData) {
  const me = await requireOwner();
  const email = String(formData.get("email") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "operator") as
    | "owner"
    | "admin"
    | "operator"
    | "viewer";

  if (!email) throw new Error("아이디 필수");
  if (!displayName) throw new Error("이름 필수");
  if (!password || password.length < 4) throw new Error("비번 4자 이상");
  if (!["owner", "admin", "operator", "viewer"].includes(role)) {
    throw new Error("잘못된 role");
  }

  await assertEmailAvailable(email); // 전역 email 중복 사전검사 (최종 방어는 마이그 012 유니크)
  const passwordHash = bcrypt.hashSync(password, BCRYPT_COST);
  await db.insert(users).values({
    tenantId: me.tenantId,
    email,
    displayName,
    passwordHash,
    role,
    isActive: true,
  });
  revalidatePath("/users");
  redirect("/users");
}

export async function updateUser(id: string, formData: FormData) {
  const me = await requireOwner();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const role = String(formData.get("role") ?? "operator") as
    | "owner"
    | "admin"
    | "operator"
    | "viewer";
  const isActive = formData.get("isActive") === "on";

  if (!displayName) throw new Error("이름 필수");
  if (!["owner", "admin", "operator", "viewer"].includes(role)) {
    throw new Error("잘못된 role");
  }

  await db
    .update(users)
    .set({ displayName, role, isActive, updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.tenantId, me.tenantId)));
  revalidatePath("/users");
}

export async function resetPassword(id: string, formData: FormData) {
  const me = await requireOwner();
  const newPassword = String(formData.get("newPassword") ?? "");
  if (!newPassword || newPassword.length < 4) throw new Error("새 비번 4자 이상");
  const passwordHash = bcrypt.hashSync(newPassword, BCRYPT_COST);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.tenantId, me.tenantId)));
  revalidatePath("/users");
}

export async function deleteUser(id: string) {
  const me = await requireOwner();
  // 본인 삭제 차단 — 지우면 자기가 못 들어온다.
  if (id === me.id) throw new Error("본인은 삭제 불가");
  await db
    .delete(users)
    .where(and(eq(users.id, id), eq(users.tenantId, me.tenantId)));
  revalidatePath("/users");
}
