import { db } from "@/lib/db";
import { customers, supportSessions, tenants } from "@/lib/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { ISSUE_TYPE_LABELS, RESOLUTION_LABELS } from "@/lib/session-labels";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

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
    })
    .from(supportSessions)
    .leftJoin(customers, eq(customers.id, supportSessions.customerId))
    .where(and(...filters))
    .orderBy(desc(supportSessions.startedAt))
    .limit(200);

  return (
    <div className="px-8 py-6 max-w-6xl">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">지원기록</h1>
          <p className="text-sm text-slate-500 mt-1">{rows.length}건 표시</p>
        </div>
      </header>

      <form className="mb-4 flex items-center gap-2 text-sm">
        <select
          name="period"
          defaultValue={period}
          className="rounded-md border border-slate-200 px-2 py-1.5"
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
          className="rounded-md border border-slate-200 px-2 py-1.5"
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
          className="rounded-md bg-slate-100 hover:bg-slate-200 px-3 py-1.5"
        >
          필터
        </button>
        {(periodParam || customerId) && (
          <Link href="/sessions" className="text-xs text-slate-400 hover:text-slate-600 underline">
            초기화
          </Link>
        )}
      </form>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">거래처</th>
              <th className="text-left px-4 py-3 font-medium">시작</th>
              <th className="text-left px-4 py-3 font-medium">소요</th>
              <th className="text-left px-4 py-3 font-medium">장애 유형</th>
              <th className="text-left px-4 py-3 font-medium">해결</th>
              <th className="text-left px-4 py-3 font-medium">내용</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const ongoing = !r.endedAt;
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    {r.customerName ?? <span className="text-slate-400">(삭제됨)</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                    {formatDate(r.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums">
                    {ongoing ? (
                      <span className="inline-block bg-rose-100 text-rose-700 px-2 py-0.5 rounded text-xs animate-pulse">
                        진행 중
                      </span>
                    ) : (
                      formatDuration(r.durationSec)
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.issueType ? ISSUE_TYPE_LABELS[r.issueType] : "-"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.resolution ? (
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${
                          r.resolution === "resolved"
                            ? "bg-emerald-100 text-emerald-700"
                            : r.resolution === "in_progress"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {RESOLUTION_LABELS[r.resolution]}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-[40ch] truncate">
                    {r.description ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-4 py-12 text-center text-slate-400 text-sm">
            해당 조건의 지원기록이 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(d: Date | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "-";
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${m % 60}분`;
}
