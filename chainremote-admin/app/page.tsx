import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { customers, supportSessions, tenants } from "@/lib/schema";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { AgentDownloadCard } from "./_agent-download-card";
import { ReleaseCard } from "./_release-card";
import { P2pCard } from "./_p2p-card";
import { canWrite } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function Home() {
  // 테넌트 격리: 로그인 사용자 회사로 한정. 대리점은 자기 회사 현황만 봐야 한다.
  // chang=betaposlab 이라 본사 화면은 그대로.
  const session = await auth();
  if (!session?.user) redirect("/login");
  const tenant = (
    await db.select().from(tenants).where(eq(tenants.id, session.user.tenantId)).limit(1)
  )[0];
  if (!tenant) redirect("/login");
  const [{ value: customerCount }] = await db
    .select({ value: count() })
    .from(customers)
    .where(eq(customers.tenantId, tenant.id));
  const [{ value: sessionCount }] = await db
    .select({ value: count() })
    .from(supportSessions)
    .where(eq(supportSessions.tenantId, tenant.id));
  // 이번 달 지원 — 이 달 1일 0시(서버 기준)부터 시작된 세션. started_at 인덱스 사용.
  // 기록됨 = A/S 내용(설명 또는 종류)을 하나라도 적은 것. 그 외 = 미기록(바빠서 [닫기]만 누른 것).
  const [{ total: monthCount, logged: monthLogged }] = await db
    .select({
      total: count(),
      logged:
        sql<number>`count(*) filter (where coalesce(${supportSessions.description}, '') <> '' or coalesce(${supportSessions.categories}, '') <> '')`.mapWith(
          Number,
        ),
    })
    .from(supportSessions)
    .where(
      and(
        eq(supportSessions.tenantId, tenant.id),
        gte(supportSessions.startedAt, sql`date_trunc('month', now())`),
      ),
    );

  return (
    <div className="px-4 py-5 md:px-8 md:py-6 max-w-6xl">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">대시보드</h1>
        <p className="text-sm text-[#b9bfd2] mt-1">
          {tenant.displayName} · 사업장 운영 현황
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-3">
        <Card label="등록 거래처" value={customerCount} suffix="곳" href="/customers" />
        <Card label="누적 지원기록" value={sessionCount} suffix="건" href="/sessions?period=all" />
        <Card
          label="이번 달 지원"
          value={monthCount}
          suffix="건"
          href="/sessions?period=thisMonth"
          subtitle={`기록 ${monthLogged} · 미기록 ${monthCount - monthLogged}`}
        />
      </div>

      {canWrite(session.user.role) && (
        <AgentDownloadCard tenantId={tenant.id} displayName={tenant.displayName} />
      )}

      {/* 최신 버전 + 이번에 달라진 것. 대리점이 "내 거래처가 최신인가"를 스스로 판단하려면
          최신 버전이 몇인지부터 알아야 한다 — 종전엔 일괄푸시 화면에서만 확인됐다. */}
      <ReleaseCard />
      {/* 직결/릴레이 비율(마이그038) — 릴레이가 곧 트래픽 비용이라 눈에 두고 본다. */}
      <P2pCard tenantId={tenant.id} />

      <section>
        <h2 className="text-lg font-semibold mb-3 text-white">시작하기</h2>
        <ul className="space-y-2 text-sm text-[#cbd1e0]">
          <li>· 좌측 "거래처"에서 등록된 거래처 확인</li>
          <li>· 좌측 "지원기록"에서 원격지원 이력 확인</li>
          {/* 2026-08-05 클라우드 전환으로 "자체 서버(외부 클라우드 미경유)" 표현이 사실과
              어긋나게 됐다 — 지금은 자사가 직접 운영하는 iwinv 서버다. 핵심(제3자 SaaS 에
              데이터를 안 맡긴다)은 그대로라 그 취지로 고쳐 썼다. */}
          <li>· 모든 데이터는 자사가 직접 운영하는 서버에 보관됩니다 (제3자 서비스 미경유)</li>
        </ul>
      </section>
    </div>
  );
}

function Card({
  label,
  value,
  suffix,
  href,
  subtitle,
}: {
  label: string;
  value: number;
  suffix: string;
  href?: string;
  subtitle?: string;
}) {
  const inner = (
    <>
      <div className="text-sm text-[#b9bfd2]">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums text-white">{value.toLocaleString()}</span>
        <span className="text-sm text-[#b9bfd2]">{suffix}</span>
      </div>
      {subtitle && <div className="mt-1 text-xs text-[#ccd2e3]">{subtitle}</div>}
    </>
  );
  const base = "panel-card block px-5 py-4 transition";
  // href 가 있으면 클릭해서 해당 목록으로 이동 — hover 로 클릭 가능함을 알린다.
  return href ? (
    <Link href={href} className={`${base} hover:border-[#7485ae]`}>
      {inner}
    </Link>
  ) : (
    <div className={base}>{inner}</div>
  );
}
