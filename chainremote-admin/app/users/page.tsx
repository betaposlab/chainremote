// 사용자 관리 페이지 — owner 전용.
// 직원 추가/수정/비번 리셋/비활성화/삭제.

import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { UserRow } from "./_user-row";
import { CreateUserForm } from "./_create-form";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "owner" && session.user.role !== "super_admin") {
    return (
      <div className="px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">사용자</h1>
        <p className="mt-2 text-sm text-red-600">
          owner 권한이 있어야 사용자 관리 페이지에 접근할 수 있습니다.
        </p>
      </div>
    );
  }

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.tenantId, session.user.tenantId))
    .orderBy(desc(users.createdAt));

  return (
    <div className="px-8 py-6 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">사용자</h1>
        <p className="text-sm text-slate-500 mt-1">
          {rows.length}명 · 본사 직원만 등록 (거래처 사람들은 여기 등록 안 함)
        </p>
      </header>

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">직원 추가</h2>
        <CreateUserForm />
      </section>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">이름</th>
              <th className="text-left px-4 py-3 font-medium">아이디</th>
              <th className="text-left px-4 py-3 font-medium">역할</th>
              <th className="text-left px-4 py-3 font-medium">활성</th>
              <th className="text-left px-4 py-3 font-medium">최종 로그인</th>
              <th className="text-right px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((u) => (
              <UserRow
                key={u.id}
                user={{
                  id: u.id,
                  email: u.email,
                  displayName: u.displayName,
                  role: u.role,
                  isActive: u.isActive,
                  lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
                }}
                isSelf={u.id === session.user.id}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
