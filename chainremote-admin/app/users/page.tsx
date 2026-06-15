// 사용자 관리 페이지.
// - super_admin(Chang): 회사별 아코디언 — 회사 위 + 클릭하면 사용자 펼침 (CompanyAccordion).
// - owner(대리점 owner): 자기 회사 직원만 (tenant 격리, 기존 동작).

import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { UserRow } from "./_user-row";
import { CreateUserForm } from "./_create-form";
import { CompanyAccordion, type AccUser } from "./_company-accordion";
import { listAllUsersWithCompany, listTenants } from "@/lib/data/tenants";

export const dynamic = "force-dynamic";

// 최신 발행 HQ 버전 (latest.json) — 직원 HQ 가 옛버전이면 경고용 비교 기준. 못 닿으면 null(배지 생략).
async function getTargetHqVersion(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("https://sepani.synology.me/chainremote/latest.json", {
      next: { revalidate: 300 },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j?.hq?.version === "string" ? j.hq.version : null;
  } catch {
    return null;
  }
}

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

  const targetHqVersion = await getTargetHqVersion();

  // super_admin(Chang): 회사별 아코디언 (회사 위 + 클릭하면 그 회사 사용자 펼침).
  if (session.user.role === "super_admin") {
    const companies = await listTenants();
    const allUsers = await listAllUsersWithCompany();
    const byTenant = new Map<string, AccUser[]>();
    for (const u of allUsers) {
      const arr = byTenant.get(u.tenantId) ?? [];
      arr.push({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        lastVersion: u.lastVersion,
        lastHeartbeatAt: u.lastHeartbeatAt ? u.lastHeartbeatAt.toISOString() : null,
      });
      byTenant.set(u.tenantId, arr);
    }
    const groups = companies.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      slug: c.slug,
      users: byTenant.get(c.id) ?? [],
    }));
    return (
      <div className="max-w-5xl px-8 py-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">사용자</h1>
          <p className="mt-1 text-sm text-slate-500">
            {allUsers.length}명 · 회사별로 묶어 표시. 회사를 클릭하면 그 회사의
            아이디가 펼쳐집니다. (거래처 사람들은 등록 안 함)
          </p>
        </header>
        <CompanyAccordion
          companies={groups}
          selfId={session.user.id}
          targetVersion={targetHqVersion}
        />
      </div>
    );
  }

  // owner(대리점): 자기 회사 직원만.
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
          {rows.length}명 · 우리 회사 직원 (거래처 사람들은 여기 등록 안 함)
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
              <th className="text-left px-4 py-3 font-medium">HQ 상태</th>
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
                  lastVersion: u.lastVersion,
                  lastHeartbeatAt: u.lastHeartbeatAt ? u.lastHeartbeatAt.toISOString() : null,
                }}
                targetVersion={targetHqVersion}
                isSelf={u.id === session.user.id}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
