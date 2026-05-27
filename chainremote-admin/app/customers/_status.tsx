// 거래처 상태 — "마지막 접속" relative time + 버전 + 색상 코드.
//
// 색상 규칙:
//   - 녹색 (online): 10분 이내 heartbeat
//   - 주황 (idle): 10분 ~ 1시간
//   - 빨강 (offline): 1시간 이상 또는 heartbeat 없음 (옛 v1.3.1 미만)
//   - 회색 (unknown): heartbeat 0건 — 거래처가 옛 binary 또는 신규 등록 직후

export function CustomerStatus({
  lastHeartbeatAt,
  lastVersion,
}: {
  lastHeartbeatAt: Date | null;
  lastVersion: string | null;
}) {
  if (!lastHeartbeatAt) {
    // heartbeat 0건 — 옛 binary (v1.3.1 이하) 또는 신규 등록 직후.
    return (
      <span className="inline-flex items-center gap-1 text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
        <span>미보고</span>
      </span>
    );
  }

  const now = Date.now();
  const last = new Date(lastHeartbeatAt).getTime();
  const diffMs = now - last;
  const diffMin = Math.floor(diffMs / 60_000);

  let color: "green" | "amber" | "red";
  let label: string;

  if (diffMin < 10) {
    color = "green";
    label = diffMin <= 1 ? "방금" : `${diffMin}분 전`;
  } else if (diffMin < 60) {
    color = "amber";
    label = `${diffMin}분 전`;
  } else if (diffMin < 60 * 24) {
    color = "red";
    label = `${Math.floor(diffMin / 60)}시간 전`;
  } else {
    color = "red";
    const days = Math.floor(diffMin / (60 * 24));
    label = `${days}일 전`;
  }

  const dotClass =
    color === "green"
      ? "bg-emerald-500"
      : color === "amber"
        ? "bg-amber-500"
        : "bg-rose-500";
  const textClass =
    color === "green"
      ? "text-emerald-700"
      : color === "amber"
        ? "text-amber-700"
        : "text-rose-700";

  return (
    <span className={`inline-flex items-center gap-1.5 ${textClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      <span className="font-mono">{label}</span>
      {lastVersion && (
        <span className="text-slate-400 text-[10px] tabular-nums">
          v{lastVersion}
        </span>
      )}
    </span>
  );
}
