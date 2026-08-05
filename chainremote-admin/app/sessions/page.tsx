import { db } from "@/lib/db";
import { customers, supportSessions, tenants, users } from "@/lib/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SessionTable } from "./_session-table";

export const dynamic = "force-dynamic";

const PERIODS = {
  // "이번 달" = 달력상 이 달 1일부터(대시보드 카드와 동일 정의). 아래 days 는 안 쓰고
  //   date_trunc 로 계산한다 — "최근 30일"(month)과 헷갈리지 않게 분리했다.
  thisMonth: { days: 0, label: "이번 달" },
  week: { days: 7, label: "최근 7일" },
  month: { days: 30, label: "최근 30일" },
  all: { days: 0, label: "전체" },
} as const;

type Period = keyof typeof PERIODS;

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: Period; customerId?: string }>;
}) {
  const { period: periodParam, customerId } = await searchParams;
  const period: Period = periodParam && periodParam in PERIODS ? periodParam : "month";

  // 테넌트 격리: 로그인 사용자 회사로 한정.
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenant = (
    await db.select().from(tenants).where(eq(tenants.id, session.user.tenantId)).limit(1)
  )[0];
  if (!tenant) redirect("/login");

  const customerOptions = await db
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(eq(customers.tenantId, tenant.id))
    .orderBy(customers.name);

  const filters = [eq(supportSessions.tenantId, tenant.id)];
  if (period === "thisMonth") {
    // 대시보드 "이번 달 지원" 카드와 100% 같은 숫자가 나오도록 동일 식을 쓴다.
    filters.push(gte(supportSessions.startedAt, sql`date_trunc('month', now())`));
  } else if (period !== "all") {
    const since = new Date(Date.now() - PERIODS[period].days * 86400_000);
    filters.push(gte(supportSessions.startedAt, since));
  }
  if (customerId) filters.push(eq(supportSessions.customerId, customerId));

  const rows = await db
    .select({
      id: supportSessions.id,
      customerId: supportSessions.customerId,
      customerName: customers.name,
      startedAt: supportSessions.startedAt,
      endedAt: supportSessions.endedAt,
      durationSec: supportSessions.durationSec,
      issueType: supportSessions.issueType,
      resolution: supportSessions.resolution,
      description: supportSessions.description,
      categories: supportSessions.categories,
      // 펼침 상세용 — 종전엔 조회조차 안 해서 패널에선 담당 직원·응대자·A/S 종류를 볼 수 없었다.
      contactName: supportSessions.contactName,
      remoteId: supportSessions.remoteId,
      operatorName: users.displayName,
    })
    .from(supportSessions)
    .leftJoin(customers, eq(customers.id, supportSessions.customerId))
    .leftJoin(users, eq(users.id, supportSessions.operatorId))
    .where(and(...filters))
    .orderBy(desc(supportSessions.startedAt))
    .limit(200);

  // Date → ISO 문자열. 클라이언트 컴포넌트 경계를 넘길 땐 직렬화 가능한 값이어야 한다.
  const tableRows = rows.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
    endedAt: r.endedAt ? new Date(r.endedAt).toISOString() : null,
    durationSec: r.durationSec,
    issueType: r.issueType,
    resolution: r.resolution,
    description: r.description,
    categories: r.categories,
    contactName: r.contactName,
    operatorName: r.operatorName,
    remoteId: r.remoteId,
  }));

  return (
    <div className="px-8 py-6 max-w-7xl">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">지원기록</h1>
          <p className="text-sm text-[#9ba2b8] mt-1">{rows.length}건 표시</p>
        </div>
      </header>

      <form className="mb-4 flex items-center gap-2 text-sm">
        <select
          name="period"
          defaultValue={period}
          className="rounded-md border border-[#2c3852] px-2 py-1.5"
        >
          {(Object.keys(PERIODS) as Period[]).map((k) => (
            <option key={k} value={k}>
              {PERIODS[k].label}
            </option>
          ))}
        </select>
        <select
          name="customerId"
          defaultValue={customerId ?? ""}
          className="rounded-md border border-[#2c3852] px-2 py-1.5"
        >
          <option value="">전체 거래처</option>
          {customerOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 text-[#d6d8de]"
        >
          필터
        </button>
        {(periodParam || customerId) && (
          <Link href="/sessions" className="text-xs text-[#838aa4] hover:text-[#abaebb] underline">
            초기화
          </Link>
        )}
      </form>

      <SessionTable rows={tableRows} />
    </div>
  );
}
