import { db } from "@/lib/db";
import { customers, supportSessions, tenants } from "@/lib/schema";
import { count, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function Home() {
  const tenant = (await db.select().from(tenants).where(eq(tenants.slug, "betaposlab")).limit(1))[0];
  const [{ value: customerCount }] = await db
    .select({ value: count() })
    .from(customers)
    .where(eq(customers.tenantId, tenant.id));
  const [{ value: sessionCount }] = await db
    .select({ value: count() })
    .from(supportSessions)
    .where(eq(supportSessions.tenantId, tenant.id));

  return (
    <div className="px-8 py-6 max-w-6xl">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
        <p className="text-sm text-slate-500 mt-1">
          {tenant.displayName} · 사업장 운영 현황
        </p>
      </header>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <Card label="등록 거래처" value={customerCount} suffix="곳" />
        <Card label="누적 지원기록" value={sessionCount} suffix="건" />
        <Card label="이번 달 지원" value={0} suffix="건" />
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">시작하기</h2>
        <ul className="space-y-2 text-sm text-slate-600">
          <li>· 좌측 "거래처"에서 등록된 거래처 확인</li>
          <li>· 좌측 "지원기록"에서 원격지원 이력 확인</li>
          <li>· DB는 Chang 댁 NAS의 PostgreSQL에 저장됩니다 (외부 서버 미경유)</li>
        </ul>
      </section>
    </div>
  );
}

function Card({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums">{value.toLocaleString()}</span>
        <span className="text-sm text-slate-500">{suffix}</span>
      </div>
    </div>
  );
}
