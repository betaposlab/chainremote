// 직결(P2P) 비율 카드 — 최근 30일 세션 기준.
//
// 왜 이 숫자를 띄우나: 릴레이로 붙은 세션은 화면·파일이 전부 우리 서버를 거쳐 그대로
//   트래픽 비용이 된다. 목표 규모(10만 대)에선 이게 인프라 비용을 좌우하는데, 정작
//   "릴레이가 몇 %인지"를 재본 적이 없어 추측만 하고 있었다(2026-08-11 착수).
//   홀펀칭 개선을 넣을 때마다 이 숫자가 올라가야 효과가 증명된다.
//
// NULL(미보고)은 분모에서 뺀다 — 구버전 HQ 가 섞여 있는 동안 비율이 왜곡되지 않게.

import { db } from "@/lib/db";
import { supportSessions } from "@/lib/schema";
import { and, eq, gte, sql, isNotNull } from "drizzle-orm";

export async function P2pCard({ tenantId }: { tenantId: string }) {
  let stats: { total: number; direct: number } | null = null;
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        direct:
          sql<number>`count(*) filter (where ${supportSessions.connDirect} = true)`.mapWith(
            Number,
          ),
      })
      .from(supportSessions)
      .where(
        and(
          eq(supportSessions.tenantId, tenantId),
          gte(supportSessions.startedAt, since),
          isNotNull(supportSessions.connDirect),
        ),
      );
    stats = row ?? null;
  } catch {
    // 대시보드가 이 카드 하나 때문에 통째로 죽으면 안 된다(마이그 전 배포 등).
    return null;
  }

  // 아직 보고된 세션이 없으면(방금 도입) 조용히 숨긴다 — 0% 로 오해하게 두지 않는다.
  if (!stats || stats.total === 0) return null;

  const pct = Math.round((stats.direct / stats.total) * 100);
  const relayed = stats.total - stats.direct;
  // 릴레이가 많을수록 비용이라 색으로 바로 읽히게: 80%↑ 좋음 / 50%↑ 보통 / 그 밑 주의.
  const tone =
    pct >= 80
      ? { bar: "bg-emerald-400", fg: "text-emerald-300" }
      : pct >= 50
        ? { bar: "bg-amber-400", fg: "text-amber-300" }
        : { bar: "bg-rose-400", fg: "text-rose-300" };

  return (
    <div className="panel-card mb-8 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-white">직접 연결 비율</h2>
        <span className="text-xs text-[#ccd2e3]">최근 30일 · {stats.total}건</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold ${tone.fg}`}>{pct}%</span>
        <span className="text-sm text-[#cbd1e0]">
          직접 {stats.direct}건 · 서버 경유 {relayed}건
        </span>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>

      <p className="mt-3 text-xs text-[#ccd2e3]">
        직접 연결은 본사와 거래처가 바로 이어져 화면·파일 전송이 빠릅니다. 서버를 경유하면
        느려지고 회선 비용도 늘어납니다.
      </p>
    </div>
  );
}
