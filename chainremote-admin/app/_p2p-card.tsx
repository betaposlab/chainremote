// 직결(P2P) 비율 카드 — 최근 30일 세션 기준 + 거래처 회선 유형 분포.
//
// 왜 이 숫자를 띄우나: 릴레이로 붙은 세션은 화면·파일이 전부 우리 서버를 거쳐 그대로
//   트래픽 비용이 된다. 목표 규모(10만 대)에선 이게 인프라 비용을 좌우하는데, 정작
//   "릴레이가 몇 %인지"를 재본 적이 없어 추측만 하고 있었다(2026-08-11 착수).
//   홀펀칭 개선을 넣을 때마다 이 숫자가 올라가야 효과가 증명된다.
//
// 아래쪽 회선 유형(마이그039)은 그 비율의 *원인*이다. 비율만 보면 "왜 낮지"에서 멈추고
//   짐작이 시작된다 — 실제로 "사설 공유기 탓"이라고 결론냈다가 같은 공유기를 쓰는 곳이
//   86% 직결이라 반증된 적이 있다. Symmetric 이 몇 대인지가 UPnP 착수 여부를 정한다.
//
// NULL(미보고)은 양쪽 다 분모에서 뺀다 — 구버전이 섞여 있는 동안 수치가 왜곡되지 않게.

import { db } from "@/lib/db";
import { customers, supportSessions } from "@/lib/schema";
import { and, eq, gte, sql, isNotNull } from "drizzle-orm";

// 0=미상(판정 실패) 1=Cone(홀펀칭 가능) 2=Symmetric(포트 예측 불가 → 경유).
interface NatCounts {
  cone: number;
  symmetric: number;
  unknown: number;
  total: number;
}

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
    stats = null;
  }

  // 회선 유형은 별도 try — 세션 통계와 도입 시점이 달라 한쪽만 있는 기간이 생긴다.
  //   내부 기기(본사 Mac·빌드머신)는 뺀다. 정할 게 "거래처 회선이 어떤가"라서.
  let nat: NatCounts | null = null;
  try {
    const [row] = await db
      .select({
        cone: sql<number>`count(*) filter (where ${customers.natType} = 1)`.mapWith(Number),
        symmetric: sql<number>`count(*) filter (where ${customers.natType} = 2)`.mapWith(Number),
        unknown: sql<number>`count(*) filter (where ${customers.natType} = 0)`.mapWith(Number),
        total: sql<number>`count(*)`.mapWith(Number),
      })
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, tenantId),
          eq(customers.isInternal, false),
          isNotNull(customers.natType),
        ),
      );
    nat = row && row.total > 0 ? row : null;
  } catch {
    nat = null;
  }

  const hasSessions = !!stats && stats.total > 0;
  // 아직 아무 보고도 없으면(방금 도입) 조용히 숨긴다 — 0% 로 오해하게 두지 않는다.
  if (!hasSessions && !nat) return null;

  return (
    <div className="panel-card mb-8 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-white">직접 연결 비율</h2>
        {hasSessions && (
          <span className="text-xs text-[#ccd2e3]">최근 30일 · {stats!.total}건</span>
        )}
      </div>

      {hasSessions ? (
        <DirectRate total={stats!.total} direct={stats!.direct} />
      ) : (
        <p className="text-sm text-[#cbd1e0]">
          최근 30일 원격 기록이 아직 없습니다.
        </p>
      )}

      <p className="mt-3 text-xs text-[#ccd2e3]">
        직접 연결은 본사와 거래처가 바로 이어져 화면·파일 전송이 빠릅니다. 서버를 경유하면
        느려지고 회선 비용도 늘어납니다.
      </p>

      {nat && <NatBreakdown nat={nat} />}
    </div>
  );
}

function DirectRate({ total, direct }: { total: number; direct: number }) {
  const pct = Math.round((direct / total) * 100);
  const relayed = total - direct;
  // 릴레이가 많을수록 비용이라 색으로 바로 읽히게: 80%↑ 좋음 / 50%↑ 보통 / 그 밑 주의.
  const tone =
    pct >= 80
      ? { bar: "bg-emerald-400", fg: "text-emerald-300" }
      : pct >= 50
        ? { bar: "bg-amber-400", fg: "text-amber-300" }
        : { bar: "bg-rose-400", fg: "text-rose-300" };

  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold ${tone.fg}`}>{pct}%</span>
        <span className="text-sm text-[#cbd1e0]">
          직접 {direct}건 · 서버 경유 {relayed}건
        </span>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${tone.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </>
  );
}

function NatBreakdown({ nat }: { nat: NatCounts }) {
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">거래처 회선 유형</h3>
        <span className="text-xs text-[#ccd2e3]">{nat.total}대 보고</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[#cbd1e0]">
        <span>
          <span className="font-semibold text-emerald-300">{nat.cone}대</span> 직접 연결 가능
        </span>
        <span>
          <span className="font-semibold text-amber-300">{nat.symmetric}대</span> 서버 경유만 가능
        </span>
        {nat.unknown > 0 && (
          <span>
            <span className="font-semibold text-[#ccd2e3]">{nat.unknown}대</span> 확인 중
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-[#ccd2e3]">
        일부 인터넷 회선·공유기는 접속할 때마다 통로를 바꿔서 직접 연결이 원천적으로 안 됩니다.
        그런 거래처는 서버 경유로만 이어집니다.
      </p>
    </div>
  );
}
