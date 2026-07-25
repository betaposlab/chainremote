"use server";

import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { assertEmailAvailable, assertSeatAvailable } from "@/lib/data/users";
import { canManageAccounts, STORABLE_ROLES, type Role } from "@/lib/roles";

// 계정 관리 게이트 — 대표자·관리자만. 직원은 거래처 작업을 다 하되 여기서만 막힌다
// (3역할 체계, 2026-07-25 Chang 확정). 다른 회사 사용자는 tenantId 격리로 애초에 안 보인다.
async function requireAccountManager() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
  if (!canManageAccounts(session.user.role)) {
    throw new Error("대표자·관리자만 직원 계정을 관리할 수 있습니다");
  }
  return session.user;
}

// 대표자 계정은 대표자(또는 플랫폼 운영자)만 건드린다 — 관리자가 대표자를 강등하거나
// 지워서 회사가 주인을 잃는 사고를 막는다.
async function assertMayTouchTarget(
  me: { id: string; role?: string },
  targetId: string,
  tenantId: string,
) {
  if (me.role === "owner" || me.role === "super_admin") return;
  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, targetId), eq(users.tenantId, tenantId)))
    .limit(1);
  if (target?.role === "owner") {
    throw new Error("대표자 계정은 대표자만 변경할 수 있습니다");
  }
}

const BCRYPT_COST = 10;

export async function createUser(formData: FormData) {
  const me = await requireAccountManager();
  const email = String(formData.get("email") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "operator") as Role;

  if (!email) throw new Error("아이디 필수");
  if (!displayName) throw new Error("이름 필수");
  if (!password || password.length < 4) throw new Error("비번 4자 이상");
  if (!STORABLE_ROLES.includes(role)) {
    throw new Error("잘못된 역할");
  }
  // 대표자 임명은 대표자만 — 관리자가 임의로 대표자를 늘리지 못하게.
  if (role === "owner" && me.role !== "owner" && me.role !== "super_admin") {
    throw new Error("대표자는 대표자만 임명할 수 있습니다");
  }

  await assertEmailAvailable(email); // 전역 email 중복 사전검사 (최종 방어는 마이그 012 유니크)
  await assertSeatAvailable(me.tenantId); // ★좌석 상한 — 아이디 무제한 생성 = 과금 회피 차단
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
  const me = await requireAccountManager();
  await assertMayTouchTarget(me, id, me.tenantId);
  const displayName = String(formData.get("displayName") ?? "").trim();
  const role = String(formData.get("role") ?? "operator") as Role;
  const isActive = formData.get("isActive") === "on";

  if (!displayName) throw new Error("이름 필수");
  if (!STORABLE_ROLES.includes(role)) {
    throw new Error("잘못된 역할");
  }
  if (role === "owner" && me.role !== "owner" && me.role !== "super_admin") {
    throw new Error("대표자는 대표자만 임명할 수 있습니다");
  }
  // 본인 행을 저장할 때 역할·활성 상태는 건드리지 않는다 — 이름만 고쳐 저장했다가
  // 스스로 직원으로 강등되거나 비활성화돼 로그인 자체가 막히던 자기잠금 사고 방지.
  if (id === me.id) {
    await db
      .update(users)
      .set({ displayName, updatedAt: new Date() })
      .where(and(eq(users.id, id), eq(users.tenantId, me.tenantId)));
    revalidatePath("/users");
    return;
  }

  // 비활성→활성 전환도 좌석을 차지하므로 상한 검사(이 아이디 제외한 활성 수 기준).
  if (isActive) await assertSeatAvailable(me.tenantId, id);

  await db
    .update(users)
    .set({ displayName, role, isActive, updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.tenantId, me.tenantId)));
  revalidatePath("/users");
}

export async function resetPassword(id: string, formData: FormData) {
  const me = await requireAccountManager();
  await assertMayTouchTarget(me, id, me.tenantId);
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
  const me = await requireAccountManager();
  // 본인 삭제 차단 — 지우면 자기가 못 들어온다.
  if (id === me.id) throw new Error("본인은 삭제 불가");
  await assertMayTouchTarget(me, id, me.tenantId);
  await db
    .delete(users)
    .where(and(eq(users.id, id), eq(users.tenantId, me.tenantId)));
  revalidatePath("/users");
}
