"use server";

import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/data/audit";
import { revokeSeat } from "@/lib/data/active-sessions";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { requireLiveUserOrThrow } from "@/lib/auth-guard";
import { assertEmailAvailable, assertSeatAvailable } from "@/lib/data/users";
import { canManageAccounts, STORABLE_ROLES, type Role } from "@/lib/roles";

// 계정 관리 게이트 — 대표자·관리자만. 직원은 거래처 작업을 다 하되 여기서만 막힌다
// (3역할 체계, 2026-07-25 Chang 확정). 다른 회사 사용자는 tenantId 격리로 애초에 안 보인다.
async function requireAccountManager() {
  // 쿠키의 존재가 아니라 **계정이 지금도 살아 있는지**를 본다(퇴사자 즉시 차단).
  //   role 도 DB 현재값이라 권한 강등이 다음 클릭부터 바로 먹는다.
  const session = { user: await requireLiveUserOrThrow() };
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
  const [created] = await db
    .insert(users)
    .values({
      tenantId: me.tenantId,
      email,
      displayName,
      passwordHash,
      role,
      isActive: true,
    })
    .returning({ id: users.id });
  await writeAudit({
    action: "user.create",
    tenantId: me.tenantId,
    userId: me.id,
    targetType: "user",
    targetId: created?.id ?? null,
    metadata: { email, role },
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

  // 바뀌기 전 값을 먼저 읽는다 — 감사로그에 "무엇에서 무엇으로"가 없으면 반쪽이다.
  const [before] = await db
    .select({ role: users.role, isActive: users.isActive })
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, me.tenantId)))
    .limit(1);

  await db
    .update(users)
    .set({ displayName, role, isActive, updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.tenantId, me.tenantId)));
  // 비활성으로 내렸으면 좌석까지 회수한다 — 안 그러면 그 사람 HQ 가 다음 토큰 롤링(수명
  // 절반, 최대 12h)까지 멀쩡히 돈다. 좌석을 비우면 ~5초 뒤 heartbeat 가 REVOKED 를 받는다.
  // 삭제는 좌석 FK 가 cascade 라 따로 할 일이 없다.
  if (!isActive) await revokeSeat(id);
  // 이름만 고친 저장은 남기지 않는다 — 권한·활성 상태가 실제로 달라졌을 때만.
  if (before && (before.role !== role || before.isActive !== isActive)) {
    await writeAudit({
      action: "user.role_change",
      tenantId: me.tenantId,
      userId: me.id,
      targetType: "user",
      targetId: id,
      metadata: {
        from: { role: before.role, isActive: before.isActive },
        to: { role, isActive },
      },
    });
  }
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
  // 비번 자체는 절대 안 남긴다 — 누가 누구 것을 언제 리셋했는지만.
  await writeAudit({
    action: "user.password_reset",
    tenantId: me.tenantId,
    userId: me.id,
    targetType: "user",
    targetId: id,
  });
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
  await writeAudit({
    action: "user.delete",
    tenantId: me.tenantId,
    userId: me.id,
    targetType: "user",
    targetId: id,
  });
  revalidatePath("/users");
}
