// 방화벽 관제 칩(마이그 028) — 이 거래처가 "방화벽 자동 해제" 대상일 때만 표시.
//   메인+오더 POS 는 방화벽을 꺼야 주문 전달·프린터 공유가 되는데, Windows 업데이트가
//   방화벽을 되살린다. 관제 켜두면 에이전트가 켜진 걸 감지해 도로 끄고(+경고 알림 끔),
//   그 누적 횟수를 여기 표시한다. 자동 해제가 잦으면 그 기기 업데이트가 잦다는 신호.
//   관제 off 인 대다수 거래처는 null 을 돌려 아무것도 그리지 않는다.

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(5, 10).replace("-", "/"); // MM/DD
}

export function FirewallChip({
  control,
  enabled,
  disarmCount,
  lastDisarmAt,
}: {
  control: boolean;
  enabled: boolean | null;
  disarmCount: number;
  lastDisarmAt: string | null; // ISO (serialize 경계)
}) {
  if (!control) return null;

  // enabled=true 면 지금 방화벽이 켜져 있다는 뜻 → 다음 감시 주기에 자동 해제 예정(잠깐 이 상태).
  const armed = enabled === true;
  const cls = armed
    ? "bg-amber-100 text-amber-700 font-medium"
    : "bg-emerald-100 text-emerald-700";

  const title = [
    "방화벽 자동 해제 켜짐",
    armed ? "지금 방화벽이 켜져 있음 → 곧 자동 해제" : "방화벽 꺼짐 유지 중",
    disarmCount > 0
      ? `자동 해제 ${disarmCount}회${lastDisarmAt ? ` (마지막 ${fmtDate(lastDisarmAt)})` : ""}`
      : "자동 해제 이력 없음",
  ].join(" · ");

  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${cls}`}
      title={title}
    >
      🛡️ 방화벽 {armed ? "해제 대기" : "꺼짐 유지"}
      {disarmCount > 0 ? ` · ${disarmCount}회` : ""}
    </span>
  );
}
