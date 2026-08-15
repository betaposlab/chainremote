// 패널 세션 가드 — "이 세션의 계정이 지금도 살아 있나"를 DB 로 확인한다.
//
// 왜 필요한가(2026-08-15 Chang "퇴사자 즉시 차단"):
//   NextAuth 세션 쿠키는 자체 서명 JWT 라, 계정을 지우거나 비활성으로 바꿔도 쿠키는 **만료
//   전까지(7일) 계속 유효해 보인다.** 페이지들이 `session?.user` 만 봤기 때문에 퇴사자가
//   최대 일주일 동안 패널을 그대로 열 수 있었다. 같은 이유로 **권한 강등도 안 먹었다**
//   (owner→직원으로 내려도 쿠키 속 role 이 옛 값이라 관리 화면이 계속 열렸다).
//
// 그래서 매 요청마다 PK 조회 한 번을 더 한다. 인덱스 조회라 비용은 무시할 수준이고,
// role·tenantId 도 **DB 현재값**을 돌려주므로 강등·이동이 즉시 반영된다.
//   → 화면에서 쓸 값은 항상 이 함수가 준 것을 쓸 것. 세션 쿠키의 role 을 믿지 말 것.
//
// HQ 앱(Bearer) 쪽 짝은 lib/api-auth.ts 의 requireApiAuth 에 있다.

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { tenants, users } from "@/lib/schema";
import type { Role } from "@/lib/roles";

export interface LiveUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  tenantId: string;
}

/** 살아 있는 계정이면 현재값을, 아니면 null. 삭제·비활성 모두 null 이다. */
export async function getLiveUser(): Promise<LiveUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const [u] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      tenantId: users.tenantId,
      isActive: users.isActive,
      tenantActive: tenants.isActive,
      subscriptionStatus: tenants.subscriptionStatus,
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(users.id, id))
    .limit(1);
  if (!u || !u.isActive) return null;
  // 정지·해지 대리점 차단(A2-07, 2026-08-16). HQ 는 requireApiAuth 가 즉시 막는데 패널만
  //   세션 쿠키 수명(7일) 동안 열려 있었다 — 거래처 관리도, **enroll-key 가 박힌 에이전트
  //   다운로드**도 그대로 됐다. super_admin(본사)은 구독 대상이 아니라 예외(자기잠금 방지).
  if (u.role !== "super_admin" && (!u.tenantActive || u.subscriptionStatus !== "active")) {
    return null;
  }
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role as Role,
    tenantId: u.tenantId,
  };
}

/** 페이지용 — 계정이 없으면 로그인 화면으로 보낸다(쿠키는 로그인 화면에서 새로 덮인다). */
export async function requireLiveUser(): Promise<LiveUser> {
  const me = await getLiveUser();
  if (!me) redirect("/login");
  return me;
}

/** 서버 액션용 — 리다이렉트 대신 예외. 액션은 화면 전환이 아니라 실패를 돌려줘야 한다. */
export async function requireLiveUserOrThrow(): Promise<LiveUser> {
  const me = await getLiveUser();
  if (!me) throw new Error("로그인 필요");
  return me;
}
