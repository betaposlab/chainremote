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

/** 경로 점검 명단(마이그043) — 비율이 아니라 **어느 집이 릴레이만 타는가**가 목적이다. */
interface ProbeRow {
  name: string;
  direct: boolean | null;
  ms: number | null;
  at: Date | null;
}

// UPnP 수치는 **우리 엔지니어링 계측**이지 대리점이 볼 것이 아니다. "공유기 포트 열기가
//   뭐냐"는 질문만 부른다(Chang 2026-08-12). 그래서 플랫폼 운영자에게만 보인다.
export async function P2pCard({
  tenantId,
  showInternals = false,
}: {
  tenantId: string;
  showInternals?: boolean;
}) {
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

  // 경로 점검 명단(마이그043). 실패해도 카드 전체가 죽으면 안 되므로 별도 try.
  let probe: ProbeRow[] | null = null;
  if (showInternals) {
    try {
      probe = await db
        .select({
          name: customers.name,
          direct: customers.probeDirect,
          ms: customers.probeMs,
          at: customers.probeAt,
        })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), isNotNull(customers.probeAt)))
        .orderBy(customers.probeDirect, customers.name);
    } catch {
      probe = null;
    }
  }

  const hasSessions = !!stats && stats.total > 0;

  // ★데이터가 없다고 카드를 숨기지 않는다. 숨기면 "아직 안 모였다"와 "기능이 배포가 안 됐다"가
  //   화면에서 똑같이 보여, 켜져 있는지 아닌지 알 방법이 없어진다(2026-08-11 실제로 그렇게 됐다 —
  //   방화벽 관제 칩에서 겪은 것과 같은 종류의 문제다). 대신 "수집 중"과 언제 채워지는지를 쓴다.
  return (
    <div className="panel-card mb-8 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-white">직접 연결 비율</h2>
        <span className="text-xs text-[#ccd2e3]">
          {hasSessions ? `최근 30일 · ${stats!.total}건` : "수집 중"}
        </span>
      </div>

      {hasSessions ? (
        <>
          <DirectRate total={stats!.total} direct={stats!.direct} />
          <p className="mt-3 text-xs text-[#ccd2e3]">
            직접 연결은 본사와 거래처가 바로 이어져 화면·파일 전송이 빠릅니다. 서버를 경유하면
            느려지고 회선 비용도 늘어납니다.
          </p>
          <CountingRule />
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-[#cbd1e0]">아직 집계된 원격이 없습니다.</p>
          <CountingRule />
        </>
      )}

      {showInternals && <NatBreakdown nat={nat} />}
      {probe && probe.length > 0 && <ProbeList rows={probe} />}
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

/** 거래처 회선 유형 — **추정치**이고 플랫폼 운영자에게만 보인다.
 *
 *  ★"직접 연결 가능 N대"를 대리점에게 보여주면 안 된다. RustDesk 의 NAT 판정은 **같은 서버
 *    IP 의 두 포트**로만 재기 때문에(common.rs test_nat_type_), 목적지 IP 마다 포트를 바꾸는
 *    공유기를 Cone(가능)으로 잘못 센다. 실제로 테스트1 은 Cone 으로 보고되는데 홀펀칭이
 *    실패한다. 실측은 경로 점검(마이그043)이 하고, 이 값은 그 원인을 짐작하는 참고일 뿐이다. */
function NatBreakdown({ nat }: { nat: NatCounts | null }) {
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">거래처 회선 유형(추정)</h3>
        <span className="text-xs text-[#ccd2e3]">
          {nat ? `${nat.total}대 보고` : "수집 중"}
        </span>
      </div>
      {nat ? (
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
      ) : (
        <p className="text-sm text-[#cbd1e0]">
          거래처가 최신 에이전트로 올라오면 채워집니다(보통 하룻밤).
        </p>
      )}
      <p className="mt-2 text-xs text-[#ccd2e3]">
        일부 인터넷 회선·공유기는 접속할 때마다 통로를 바꿔서 직접 연결이 원천적으로 안 됩니다.
        <span className="text-[#8a93ad]">
          {" "}
          단 이 값은 추정입니다 — &quot;가능&quot;으로 잡혀도 실제로는 안 뚫리는 회선이 있어
          실측은 아래 경로 점검이 합니다.
        </span>
      </p>
    </div>
  );
}


/** 무엇이 분모에서 빠지는지 — 항상 보인다.
 *
 *  ★2026-08-13: "어제 원격을 많이 했는데 왜 2건이냐"는 질문이 나왔다. 실제로 그날 건
 *    대부분이 내부 기기(우리집·재성이 컴) 대상이라 세션이 아예 안 만들어졌다
 *    (app/api/sessions/route.ts 의 internal 스킵 — 지원 이력에 내 장비를 섞지 않으려는
 *    의도된 설계다). 규칙이 화면에 없으면 정상 동작이 고장으로 읽힌다. */
function CountingRule() {
  return (
    <p className="mt-2 text-xs text-[#8a93ad]">
      집계에서 빠지는 것: <span className="text-[#ccd2e3]">내부 기기</span>(본사 PC·테스트
      장비 — 지원 이력에 안 남기므로 여기서도 빠집니다) ·{" "}
      <span className="text-[#ccd2e3]">15초 미만 접속</span>(잠깐 확인만 하고 닫은 것).
    </p>
  );
}

/** 경로 점검 결과 명단 — 플랫폼 운영자에게만.
 *
 *  ★비율이 아니라 이름이 목적이다. 거래처 26곳으로 비율을 재 봐야 ±19%p 밖에 못 좁힌다
 *    (표본 단위가 세션이 아니라 거래처다). 릴레이만 타는 집이 소수면 그 집들을 개별로 파고,
 *    다수면 구조적이라는 뜻이니 릴레이를 받아들이고 화질 쪽을 손보면 된다.
 *    그 판단에 필요한 건 숫자가 아니라 명단이다. */
function ProbeList({ rows }: { rows: ProbeRow[] }) {
  const relay = rows.filter((r) => r.direct === false);
  const direct = rows.filter((r) => r.direct === true);
  const failed = rows.filter((r) => r.direct === null);
  const at = rows.map((r) => r.at?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">경로 점검 결과</h3>
        <span className="text-xs text-[#ccd2e3]">
          {at ? new Date(at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : ""}
        </span>
      </div>
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[#cbd1e0]">
        <span>
          <span className="font-semibold text-emerald-300">{direct.length}곳</span> 직접 연결
        </span>
        <span>
          <span className="font-semibold text-amber-300">{relay.length}곳</span> 서버 경유
        </span>
        {failed.length > 0 && (
          <span>
            <span className="font-semibold text-[#ccd2e3]">{failed.length}곳</span> 연결 안 됨
          </span>
        )}
      </div>
      {relay.length > 0 && (
        <p className="text-xs leading-relaxed text-[#ccd2e3]">
          <span className="text-amber-300">서버 경유:</span>{" "}
          {relay.map((r) => r.name).join(" · ")}
        </p>
      )}
      <p className="mt-2 text-xs text-[#8a93ad]">
        본사 앱이 거래처마다 연결만 해 보고 끊은 결과입니다. 거래처 화면에는 아무것도 뜨지
        않습니다.
      </p>
    </div>
  );
}
