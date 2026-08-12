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
  // 공유기 UPnP(040) — 홀펀칭이 안 되는 곳을 직결로 되살릴 수 있는지.
  upnpYes: number;
  upnpNo: number;
  upnpTotal: number;
  // 실제로 포트를 연 곳(041) 과, 그 문이 바깥에서 진짜 열렸는지(042).
  doorOn: number;
  doorOpen: number;
  doorFake: number;
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
        upnpYes: sql<number>`count(*) filter (where ${customers.upnp} = 'yes')`.mapWith(Number),
        upnpNo: sql<number>`count(*) filter (where ${customers.upnp} in ('no','found'))`.mapWith(Number),
        upnpTotal: sql<number>`count(*) filter (where ${customers.upnp} is not null)`.mapWith(Number),
        doorOn: sql<number>`count(*) filter (where ${customers.upnpEnabled})`.mapWith(Number),
        // 열림 = 클라우드가 그 주소를 두드려 에이전트 인사까지 받은 것(6시간 신선도).
        doorOpen:
          sql<number>`count(*) filter (where ${customers.upnpEnabled} and ${customers.upnpVerifiedAt} > now() - interval '6 hours')`.mapWith(
            Number,
          ),
        // 거짓 열림 = 공유기는 주소를 내줬는데 바깥에서 두드리니 안 열리는 것.
        doorFake:
          sql<number>`count(*) filter (where ${customers.upnpEnabled} and ${customers.upnpEndpoint} is not null and ${customers.upnpProbeAt} is not null and (${customers.upnpVerifiedAt} is null or ${customers.upnpVerifiedAt} <= now() - interval '6 hours'))`.mapWith(
            Number,
          ),
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
        </>
      ) : (
        <p className="text-sm leading-relaxed text-[#cbd1e0]">
          아직 집계된 원격이 없습니다.{" "}
          <span className="text-[#ccd2e3]">
            15초 미만으로 끊은 접속은 지원 이력에 안 남아 여기서도 빠집니다 — 잠깐 확인만 하고
            닫은 접속은 세지지 않습니다.
          </span>
        </p>
      )}

      <NatBreakdown nat={nat} />
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

function NatBreakdown({ nat }: { nat: NatCounts | null }) {
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">거래처 회선 유형</h3>
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
        그런 거래처는 서버 경유로만 이어집니다.
      </p>
      {nat && nat.upnpTotal > 0 && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">공유기 포트 열기(UPnP)</h3>
            <span className="text-xs text-[#ccd2e3]">{nat.upnpTotal}대 조사됨</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[#cbd1e0]">
            <span>
              <span className="font-semibold text-emerald-300">{nat.upnpYes}대</span> 가능
            </span>
            <span>
              <span className="font-semibold text-[#ccd2e3]">{nat.upnpNo}대</span> 불가
            </span>
          </div>
          <p className="mt-2 text-xs text-[#ccd2e3]">
            공유기에 통로를 직접 열어 달라고 요청할 수 있는 거래처 수입니다. 직접 연결이 안 되던
            곳도 이 방법으로는 이어질 수 있습니다.
          </p>
          {nat.doorOn > 0 && <DoorVerify nat={nat} />}
        </div>
      )}
    </div>
  );
}

/** 실제로 연 문이 바깥에서 열려 있는지 — 공유기 말이 아니라 실측 결과.
 *
 *  ★이 줄이 있는 이유: 우리집 공유기는 AddPortMapping 을 받아 주고 되읽어도 매핑이 멀쩡한데
 *    인터넷에서 오는 연결을 랜 안쪽으로 넘기지 않았다(2026-08-12). 그래서 "가능 N대"만 세면
 *    실제 성과를 몇 배로 부풀려 읽게 된다. 켠 곳 중 진짜 열린 곳을 따로 센다. */
function DoorVerify({ nat }: { nat: NatCounts }) {
  const waiting = Math.max(0, nat.doorOn - nat.doorOpen - nat.doorFake);
  return (
    <div className="mt-3 rounded-lg bg-white/5 p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold text-white">실제로 연 문</h4>
        <span className="text-xs text-[#ccd2e3]">{nat.doorOn}대 켜짐</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[#cbd1e0]">
        <span>
          <span className="font-semibold text-emerald-300">{nat.doorOpen}대</span> 열림(확인됨)
        </span>
        {nat.doorFake > 0 && (
          <span>
            <span className="font-semibold text-rose-300">{nat.doorFake}대</span> 공유기만 열었다고 함
          </span>
        )}
        {waiting > 0 && (
          <span>
            <span className="font-semibold text-[#ccd2e3]">{waiting}대</span> 확인 대기
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-[#ccd2e3]">
        공유기가 열었다고 대답해도 실제로는 안 열리는 제품이 있습니다. 그래서 바깥(우리 서버)에서
        직접 두드려 보고, 응답이 온 곳만 열린 것으로 셉니다.
      </p>
    </div>
  );
}
