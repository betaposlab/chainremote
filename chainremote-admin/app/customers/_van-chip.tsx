// VAN 카드결제 데몬 관제 칩(마이그 036) — 관제를 켠 거래처에만 표시.
//   데몬이 멈추면 화면엔 아무 표시도 없이 카드만 안 긁힌다. 그래서 여기서는 "지금 정상인가"를
//   가장 크게 보여주고, 되살린 누적 횟수를 옆에 붙인다(잦으면 그 기기 데몬이 불안정하다는 신호).
//   gaveUp 은 재실행으로 안 낫는 고장이라는 뜻이라 빨강으로 띄운다 — 리더기가 빠졌거나 COM
//   포트가 어긋난 경우가 대부분이고, 사람이 가야 한다.
//   관제 off 인 대다수 거래처는 null 을 돌려 아무것도 그리지 않는다.

import { vanLabel } from "@/lib/van-constants";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(5, 10).replace("-", "/"); // MM/DD
}

export function VanChip({
  kind,
  ok,
  gaveUp,
  missing,
  restartCount,
  lastRestartAt,
}: {
  kind: string | null;
  ok: boolean | null;
  gaveUp: boolean;
  /** 데몬이 그 기기에 아예 없음(037) — 다른 VAN 거래처에 잘못 켠 경우. */
  missing: boolean;
  restartCount: number;
  lastRestartAt: string | null; // ISO (serialize 경계)
}) {
  if (!kind) return null;

  const name = vanLabel(kind);
  const restarts =
    restartCount > 0
      ? `되살림 ${restartCount}회${lastRestartAt ? ` (마지막 ${fmtDate(lastRestartAt)})` : ""}`
      : "되살린 이력 없음";

  // 데몬이 아예 없는 건 고장이 아니라 설정 실수다. 사람을 부르는 대신 "관제를 끄세요"라고
  // 말해야 한다 — 같은 빨강으로 묶으면 있지도 않은 고장을 고치러 나간다.
  if (missing) {
    return (
      <span
        className="inline-block px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap bg-amber-500/15 text-amber-300 font-medium"
        title={`이 기기에 ${name} 데몬(프로그램)이 없습니다. 다른 VAN 사를 쓰는 거래처로 보입니다 — 관제를 끄거나 맞는 VAN 으로 바꾸세요.`}
      >
        💳 {name} 없음 · 설정 확인
      </span>
    );
  }

  // 손 뗀 상태가 가장 급하다 — 자동 복구가 안 되는 고장이라 사람이 안 가면 계속 결제 불가다.
  if (gaveUp) {
    return (
      <span
        className="inline-block px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap bg-rose-500/15 text-rose-300 font-medium"
        title={`${name} 데몬 자동 복구 실패 — 재실행으로 안 낫습니다. 리더기 연결·COM 포트를 확인하세요 · ${restarts}`}
      >
        💳 {name} 복구 실패
      </span>
    );
  }

  // ok=null 은 아직 보고 전(방금 켰거나 구버전 에이전트). 켜 둔 사실만 조용히 표시한다.
  if (ok === null) {
    return (
      <span
        className="inline-block px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap chip chip-neutral"
        // 주기 10분 × 2(지시 전달 + 결과 회신)라 최대 20분이다. 이 말이 없으면 고장으로 읽힌다.
        title={`${name} 데몬 관제 켜짐 — 에이전트가 다음 보고에서 확인합니다(최대 20분)`}
      >
        💳 {name} 대기
      </span>
    );
  }

  const cls = ok
    ? "chip chip-ok"
    : "bg-amber-500/12 text-amber-300 font-medium";

  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${cls}`}
      title={[
        `${name} 카드결제 데몬 관제 켜짐`,
        ok ? "데몬 정상" : "데몬 멈춤 — 곧 자동으로 되살립니다",
        restarts,
      ].join(" · ")}
    >
      💳 {name} {ok ? "정상" : "복구 중"}
      {restartCount > 0 ? ` · ${restartCount}회` : ""}
    </span>
  );
}
