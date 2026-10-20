// 방화벽 관제 칩(마이그 028) — 이 거래처가 "방화벽 자동 해제" 대상일 때만 표시.
//   메인+오더 POS 는 방화벽을 꺼야 주문 전달·프린터 공유가 되는데, Windows 업데이트가
//   방화벽을 되살린다. 관제 켜두면 에이전트가 켜진 걸 감지해 도로 끄고(+경고 알림 끔),
//   그 누적 횟수를 여기 표시한다. 자동 해제가 잦으면 그 기기 업데이트가 잦다는 신호.
//   관제 off 인 대다수 거래처는 null 을 돌려 아무것도 그리지 않는다.
//
// ★"해제 실패"(마이그 060, 2026-10-20). 종전엔 켜져 있으면 무조건 "해제 대기 → 곧 자동 해제"라고
//   했다. 테스트1 은 끄는 명령이 10분 멈췄고 샵단란주점은 한 번도 못 껐는데 둘 다 "해제 대기"였다.
//   에이전트(1.4.157~)가 실패 이유를 보내면 그걸 그대로 말한다.

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(5, 10).replace("-", "/"); // MM/DD
}

/** 실패 코드(에이전트 chainremote_proc::RunError::code)를 사람 말로. HQ 의 crFirewallErrorText 와 같은 문구. */
export function firewallErrorText(code: string): string {
  if (code === "timeout") return "끄는 명령이 30초 안에 끝나지 않음";
  if (code === "spawn") return "끄는 명령을 실행하지 못함";
  if (code === "wait") return "끄는 명령의 상태를 확인하지 못함";
  if (/^exit/.test(code)) {
    const n = code.slice(4);
    return n ? `끄는 명령이 실패함(코드 ${n})` : "끄는 명령이 실패함";
  }
  return `끄지 못함(${code})`;
}

export function FirewallChip({
  control,
  enabled,
  disarmCount,
  lastDisarmAt,
  disarmError = null,
  disarmErrorAt = null,
}: {
  control: boolean;
  enabled: boolean | null;
  disarmCount: number;
  lastDisarmAt: string | null; // ISO (serialize 경계)
  disarmError?: string | null;
  disarmErrorAt?: string | null; // ISO
}) {
  if (!control) return null;

  // enabled=true 면 지금 방화벽이 켜져 있다는 뜻. 실패 이유가 함께 오면 "해제 실패", 아니면
  //   다음 감시 주기에 꺼질 참이라 "해제 대기".
  const armed = enabled === true;
  const failing = armed && !!disarmError;
  const cls = failing
    ? "bg-rose-500/15 text-rose-300 font-medium"
    : armed
      ? "bg-amber-500/12 text-amber-300 font-medium"
      : "chip chip-ok";

  const title = [
    "방화벽 자동 해제 켜짐",
    failing
      ? `방화벽을 끄지 못하고 있음 — ${firewallErrorText(disarmError!)}${
          disarmErrorAt ? ` (마지막 ${fmtDate(disarmErrorAt)})` : ""
        }. 에이전트가 계속 다시 시도함`
      : armed
        ? "지금 방화벽이 켜져 있음 → 곧 자동 해제"
        : "방화벽 꺼짐 유지 중",
    disarmCount > 0
      ? `자동 해제 ${disarmCount}회${lastDisarmAt ? ` (마지막 ${fmtDate(lastDisarmAt)})` : ""}`
      : "자동 해제 이력 없음",
  ].join(" · ");

  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${cls}`}
      title={title}
    >
      🛡️ 방화벽 {failing ? "해제 실패" : armed ? "해제 대기" : "꺼짐 유지"}
      {disarmCount > 0 ? ` · ${disarmCount}회` : ""}
    </span>
  );
}
