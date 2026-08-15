import { db } from "@/lib/db";
import { customers, supportSessions, tenants, users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Suspense } from "react";
import { SessionTable } from "./_session-table";
import { SessionFilterBar } from "./_filter-bar";
import { AddRecordButton } from "./_add-record";
import { searchSessions, countSessionsAllPeriods } from "@/lib/data/sessions";

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
  searchParams: Promise<{ period?: Period; customerId?: string; q?: string; discarded?: string }>;
}) {
  const { period: periodParam, customerId, q: qParam, discarded } = await searchParams;
  // "폐기 포함" — 폐기된 기록은 지워진 게 아니라 숨겨진 것이다(마이그045). 켜면 같이 나온다.
  const includeDiscarded = discarded === "1";
  const period: Period = periodParam && periodParam in PERIODS ? periodParam : "month";
  // 검색어. 앞뒤 공백을 떼고 길이를 자른다 — 긴 문자열로 LIKE 를 때리면 느려진다.
  const q = (qParam ?? "").trim().slice(0, 60);

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

  // 쿼리는 lib/data/sessions.ts 에 있다 — 테넌트 격리가 걸린 코드라 테스트가 닿는
  //   자리에 둔다(test/adv-session-search.test.ts). 여기서 두 번째 사본을 만들지 말 것.
  const rows = await searchSessions({
    tenantId: tenant.id,
    period,
    customerId,
    q,
    includeDiscarded,
    limit: 200,
  });

  const customerName = customerId
    ? customerOptions.find((c) => c.id === customerId)?.name ?? null
    : null;

  // ★파생 문제 방어: 기본 기간이 "최근 30일"이라 석 달 전 기록을 검색하면 0건이 나오고,
  //   사람은 "검색이 안 되네"로 읽는다. 이 화면에서 0건일 때만 기간을 풀어 다시 세어
  //   "기간 밖에 N건 있다"고 알려 준다. 0건일 때만 도는 추가 조회라 평소 비용은 없다.
  // ★파생 문제 방어: 기본 기간이 "최근 30일"이라 석 달 전 기록을 검색하면 0건이 나오고,
  //   사람은 "검색이 안 되네"로 읽는다. 0건일 때만 기간을 풀어 다시 세어 알려 준다.
  const outsidePeriod =
    rows.length === 0 && q && period !== "all"
      ? await countSessionsAllPeriods({ tenantId: tenant.id, customerId, q, includeDiscarded })
      : 0;

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
    discardedAt: r.discardedAt ? new Date(r.discardedAt).toISOString() : null,
    manual: r.manual,
  }));

  return (
    <div className="px-4 py-5 md:px-8 md:py-6 max-w-7xl">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">지원기록</h1>
          <p className="text-sm text-[#b9bfd2] mt-1">
            {PERIODS[period].label}
            {customerName ? ` · ${customerName}` : ""}
            {q ? ` · "${q}" 검색` : ""}
            {" · "}
            {rows.length}건
            {/* 200건 상한에 걸리면 그 사실을 알린다 — 말 안 하면 "이게 전부"로 읽힌다. */}
            {rows.length >= 200 ? " (최근 200건까지)" : ""}
            {includeDiscarded ? " · 폐기 포함" : ""}
          </p>
          <p className="text-xs text-[#8b93ab] mt-1">
            원격이 15초 이상이면 내용을 안 적어도 접속 사실은 반드시 남습니다(폐기해도 숨길 뿐).
            15초 미만 오접속은 기록하지 않습니다.
          </p>
        </div>
        <AddRecordButton customers={customerOptions} />
      </header>

      {/* 조회 줄은 클라이언트 컴포넌트다 — 글자를 치는 즉시 걸러지고, 기간·거래처도
          고르는 즉시 반영된다. 그래서 [조회] 버튼이 없다(누를 것이 없다).
          자세한 이유는 _filter-bar.tsx 머리말 참조. */}
      <Suspense fallback={<div className="mb-4 h-9" />}>
        <SessionFilterBar customers={customerOptions} />
      </Suspense>

      {tableRows.length === 0 ? (
        <div className="rounded-lg border border-[#2b3a5f] bg-white/[0.02] px-5 py-10 text-center">
          <p className="text-[#eef1f7]">조건에 맞는 지원기록이 없습니다.</p>
          {outsidePeriod > 0 ? (
            <>
              <p className="mt-1.5 text-sm text-[#9aa3ba]">
                다만 <b className="text-[#eef1f7]">{PERIODS[period].label}</b> 밖에{" "}
                <b className="text-[#eef1f7]">{outsidePeriod}건</b>이 더 있습니다.
              </p>
              <Link
                href={`/sessions?period=all&q=${encodeURIComponent(q)}${
                  customerId ? `&customerId=${customerId}` : ""
                }`}
                className="mt-3 inline-block rounded-md bg-[#2f4a86] hover:bg-[#3a5a9e] px-3.5 py-1.5 text-sm font-medium text-white"
              >
                전체 기간에서 다시 찾기
              </Link>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-[#9aa3ba]">
                기간을 넓히거나 검색어를 지우고 다시 조회해 보세요.
              </p>
              <Link
                href="/sessions"
                className="mt-3 inline-block text-sm text-[#8fb3ff] hover:text-white underline"
              >
                전체 보기
              </Link>
            </>
          )}
        </div>
      ) : (
        <SessionTable rows={tableRows} />
      )}
    </div>
  );
}
