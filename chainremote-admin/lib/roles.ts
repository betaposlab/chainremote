// 역할 정의 단일 출처 (2026-07-25 Chang 확정 — 3역할 체계).
//
// 표시 용어는 대표자 / 관리자 / 직원 셋뿐이다. DB enum(user_role)은 5값 그대로 두고
//   (Postgres 는 enum 값 삭제가 불가 + 옛 세션 쿠키·HQ 토큰이 며칠간 옛 문자열을 들고 다닌다)
//   코드와 화면에서만 셋으로 접는다. 그래서 마이그레이션도 HQ 재빌드도 필요 없다.
//
// 권한 축은 딱 하나 — **계정 관리(직원 추가·비번 변경·역할 변경)**:
//   대표자·관리자 = 가능 / 직원 = 불가.
// 그 외 거래처 작업(추가·수정·★삭제·푸시·방화벽·디스크 정리·원격 지원)은 직원도 전부 한다.
//   ("우리 업무 특성상 직원도 모든 걸 다 해야 한다. 비번 변경만 못 하게" — Chang)
//
// viewer 는 진짜 읽기 전용이던 옛 값이다. 신규 배정에서 뺐지만(ASSIGNABLE_ROLES) enum 과
//   requireNotViewer 게이트는 남겨둔다 — 나중에 "정말 보기만" 계정이 필요해질 때 되살릴 자리.

export type Role = "owner" | "admin" | "operator" | "viewer" | "super_admin";

const LABELS: Record<Role, string> = {
  owner: "대표자",
  admin: "관리자",
  operator: "직원",
  viewer: "직원(읽기 전용)", // 레거시 — 신규 배정 안 함
  super_admin: "플랫폼 운영자", // Chang. 대리점 화면엔 안 나옴
};

export function roleLabel(role: string): string {
  return LABELS[role as Role] ?? role;
}

/** 직원 추가/수정 드롭다운에 뜨는 역할. viewer 는 레거시라 제외. */
export const ASSIGNABLE_ROLES: ReadonlyArray<{
  value: Role;
  label: string;
  hint: string;
}> = [
  { value: "owner", label: "대표자", hint: "전체 권한 + 계정 관리" },
  { value: "admin", label: "관리자", hint: "전체 권한 + 계정 관리" },
  { value: "operator", label: "직원", hint: "거래처·원격 전체 (계정 관리 제외)" },
];

/** 저장 시 서버가 받아들이는 역할 값 — 레거시 viewer 도 통과시켜야 옛 계정 수정이 안 막힌다. */
export const STORABLE_ROLES: readonly Role[] = [
  "owner",
  "admin",
  "operator",
  "viewer",
];

/** 계정 관리(직원 추가·비번 변경·역할 변경·삭제) 권한. 직원(operator)은 여기서만 막힌다. */
export function canManageAccounts(role: string | undefined): boolean {
  return role === "owner" || role === "admin" || role === "super_admin";
}

/** 거래처·원격 작업 권한. 직원 포함 전원 허용, 레거시 viewer 만 제외. */
export function canWrite(role: string | undefined): boolean {
  return !!role && role !== "viewer";
}
