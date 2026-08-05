// 사용자 관리 페이지.
// super_admin(Chang) 은 회사별 아코디언(CompanyAccordion), owner 는 tenant 격리로 자기 회사 직원만 본다.

import { db } from "@/lib/db";
import { users, tenants } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { UserRow } from "./_user-row";
import { CreateUserForm } from "./_create-form";
import { CompanyAccordion, type AccUser } from "./_company-accordion";
import { listAllUsersWithCompany, listTenants } from "@/lib/data/tenants";
import { canManageAccounts } from "@/lib/roles";

export const dynamic = "force-dynamic";

// latest.json 의 최신 발행 HQ 버전 — 직원 HQ 옛버전 경고의 비교 기준. 못 닿으면 null(배지 생략).
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
  if (!canManageAccounts(session.user.role)) {
    return (
      <div className="px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">사용자</h1>
        <p className="mt-2 text-sm text-[#ff9a9e]">
          대표자·관리자만 직원 계정을 관리할 수 있습니다.
        </p>
      </div>
    );
  }

  const targetHqVersion = await getTargetHqVersion();

  // super_admin(Chang): 회사별 아코디언.
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
          <p className="mt-1 text-sm text-[#9ba2b8]">
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

  // 좌석 현황 — 활성 아이디(=동시 세션) 수 / 보유 좌석. 상한이면 추가 폼 대신 안내.
  const [tenantRow] = await db
    .select({ maxSeats: tenants.maxSeats })
    .from(tenants)
    .where(eq(tenants.id, session.user.tenantId));
  const maxSeats = tenantRow?.maxSeats ?? 1;
  const usedSeats = rows.filter((u) => u.isActive).length;
  const seatFull = usedSeats >= maxSeats;

  return (
    <div className="px-8 py-6 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">사용자</h1>
        <p className="text-sm text-[#9ba2b8] mt-1">
          {rows.length}명 · 좌석{" "}
          <span className={seatFull ? "font-semibold text-amber-300" : "font-semibold text-[#d6d8de]"}>
            {usedSeats} / {maxSeats}
          </span>{" "}
          사용 · 우리 회사 직원 (거래처 사람들은 여기 등록 안 함)
        </p>
      </header>

      <section className="mb-8 panel-card p-5">
        <h2 className="mb-4 text-sm font-semibold text-[#d6d8de]">직원 추가</h2>
        {seatFull ? (
          <div className="rounded-lg banner banner-warn">
            <p>
              좌석을 모두 사용 중입니다 ({usedSeats} / {maxSeats}석). 아이디 하나가
              동시 1명의 원격을 담당하므로, 직원을 더 추가하려면 좌석을 추가로
              구매하셔야 합니다.
            </p>
            <a
              href="https://betaposlab.com/chainremote#contact"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              좌석 추가 문의하기 →
            </a>
          </div>
        ) : (
          <CreateUserForm />
        )}
      </section>

      <div className="panel-table-wrap">
        <table className="panel-table">
          <thead>
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
          <tbody>
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
