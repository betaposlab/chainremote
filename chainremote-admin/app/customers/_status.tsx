// 거래처 상태 — "마지막 접속" relative time + 버전 + 색상 코드 + 업데이트 건강도(brick 감지).
//
// heartbeat 색상 규칙:
//   - 녹색 (online): 10분 이내 heartbeat
//   - 주황 (idle): 10분 ~ 1시간
//   - 빨강 (offline): 1시간 이상 또는 heartbeat 없음 (옛 v1.3.1 미만)
//   - 회색 (unknown): heartbeat 0건 — 거래처가 옛 binary 또는 신규 등록 직후
//
// 업데이트 건강도 (자동업데이트 brick 가시화 — 2026-06-05):
//   에이전트는 설치를 "실행"만 하면 즉시 패널에 applied 보고함(완료 확인 전). 이후 설치가
//   실패(copy 깨짐 등)하면 패널엔 성공인데 거래처는 죽어있음(brick). heartbeat 가 보고하는
//   버전이 push 목표 버전으로 안 올라가면 그 사고를 여기서 드러냄.
//   - failed:  에이전트가 명시적으로 실패 보고 (failed_at)
//   - brick:   applied 됐는데 GRACE 시간 지나도 heartbeat 버전이 목표로 안 올라감 (의심)
//   - pending: applied 됐고 아직 GRACE 시간 내 (설치+heartbeat 도는 중)
//   - ok:      heartbeat 버전 == 목표 버전 (정상 적용 확인)

export const BRICK_GRACE_MIN = 20; // applied 후 이 시간 지나도 버전 안 오르면 brick 의심 (heartbeat 10분 주기 2회 여유)

export type UpdateInfo = {
  targetVersion: string;
  appliedAt: Date | null;
  failedAt: Date | null;
  failureReason?: string | null;
} | null;

export type UpdateHealth =
  | { kind: "failed"; targetVersion: string; failureReason?: string | null }
  | { kind: "brick"; targetVersion: string; ageMin: number }
  | { kind: "pending"; targetVersion: string }
  | { kind: "ok"; targetVersion: string }
  | null;

// 버전 비교 — "현재가 목표보다 낮은가"(=업뎃이 안 올라갔나). null(미보고)은 낮음으로 취급.
// 현재가 목표 이상(같거나 더 새 버전)이면 정상 — 이후 더 새 버전을 받은 경우(예: 우리집)도 정상.
function parseVer(v: string): [number, number, number] {
  const p = v.split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
}
function isOlder(current: string | null, target: string): boolean {
  if (!current) return true;
  const a = parseVer(current);
  const b = parseVer(target);
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false; // 같음
}

// 순수 함수 — 컴포넌트(배지)와 페이지(요약 카운트) 양쪽에서 동일 판정.
export function computeUpdateHealth(
  update: UpdateInfo | undefined,
  lastVersion: string | null,
): UpdateHealth {
  if (!update) return null;
  if (update.failedAt)
    return { kind: "failed", targetVersion: update.targetVersion, failureReason: update.failureReason ?? null };
  if (update.appliedAt) {
    // 현재 버전이 목표 이상이면 정상 적용 (같거나 더 새 버전 — 이후 다른 업뎃 받은 경우 포함).
    if (!isOlder(lastVersion, update.targetVersion)) {
      return { kind: "ok", targetVersion: update.targetVersion };
    }
    // 현재가 목표보다 낮음 = "적용됨" 보고됐는데 버전이 안 올라감 → 의심.
    const ageMin = Math.floor((Date.now() - new Date(update.appliedAt).getTime()) / 60_000);
    if (ageMin >= BRICK_GRACE_MIN) {
      return { kind: "brick", targetVersion: update.targetVersion, ageMin };
    }
    return { kind: "pending", targetVersion: update.targetVersion };
  }
  return null;
}

export function CustomerStatus({
  lastHeartbeatAt,
  lastVersion,
  update,
  isInternal = false,
}: {
  lastHeartbeatAt: Date | null;
  lastVersion: string | null;
  update?: UpdateInfo;
  isInternal?: boolean;
}) {
  // 내부 기기(본사/Mac/빌드머신): 상태 칸 빈칸 — heartbeat/버전/배지 전부 숨김. 자동업뎃 대상 아님.
  if (isInternal) {
    return null;
  }

  const health = computeUpdateHealth(update, lastVersion);

  const heartbeat = renderHeartbeat(lastHeartbeatAt, lastVersion);

  if (!health || health.kind === "ok") {
    return heartbeat;
  }

  return (
    <div className="flex flex-col gap-1">
      {heartbeat}
      <UpdateBadge health={health} />
    </div>
  );
}

// HQ 본사앱 직원 상태 — 마지막 heartbeat(접속) + HQ 버전 + 옛버전 경고. 거래처(CustomerStatus)의 HQ 판.
// lastHeartbeatAt 은 ISO 문자열(서버→클라 직렬화). targetVersion=최신 발행 HQ 버전(latest.json), null이면 비교 생략.
export function HqStatus({
  lastVersion,
  lastHeartbeatAt,
  targetVersion,
}: {
  lastVersion: string | null;
  lastHeartbeatAt: string | null;
  targetVersion: string | null;
}) {
  const hb = renderHeartbeat(lastHeartbeatAt ? new Date(lastHeartbeatAt) : null, lastVersion);
  const stale = !!(lastVersion && targetVersion && isOlder(lastVersion, targetVersion));
  if (!stale) return hb;
  return (
    <div className="flex flex-col gap-1">
      {hb}
      <span className="inline-flex w-fit items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
        ⚠ 옛 버전 (최신 v{targetVersion})
      </span>
    </div>
  );
}

function UpdateBadge({ health }: { health: NonNullable<UpdateHealth> }) {
  if (health.kind === "ok") return null;
  if (health.kind === "pending") {
    return (
      <span className="inline-flex w-fit items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
        업뎃 적용중 v{health.targetVersion}
      </span>
    );
  }
  if (health.kind === "failed") {
    return (
      <span
        className="inline-flex w-fit items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700"
        title={health.failureReason ?? undefined}
      >
        ⚠ 업뎃 실패 v{health.targetVersion}
      </span>
    );
  }
  // brick
  return (
    <span
      className="inline-flex w-fit items-center gap-1 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"
      title={`푸시 적용 보고 후 ${health.ageMin}분 지나도록 v${health.targetVersion} heartbeat 미수신 — 설치 실패/brick 의심. 거래처 PC 점검 필요(RDP/현장).`}
    >
      ⚠ 업뎃 미확인 v{health.targetVersion}
    </span>
  );
}

function renderHeartbeat(lastHeartbeatAt: Date | null, lastVersion: string | null) {
  if (!lastHeartbeatAt) {
    return (
      <span className="inline-flex items-center gap-1 text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        <span>미보고</span>
      </span>
    );
  }

  const now = Date.now();
  const last = new Date(lastHeartbeatAt).getTime();
  const diffMin = Math.floor((now - last) / 60_000);

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
    label = `${Math.floor(diffMin / (60 * 24))}일 전`;
  }

  const dotClass =
    color === "green" ? "bg-emerald-500" : color === "amber" ? "bg-amber-500" : "bg-rose-500";
  const textClass =
    color === "green" ? "text-emerald-700" : color === "amber" ? "text-amber-700" : "text-rose-700";

  return (
    <span className={`inline-flex items-center gap-1.5 ${textClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      <span className="font-mono">{label}</span>
      {lastVersion && (
        <span className="text-[10px] tabular-nums text-slate-400">v{lastVersion}</span>
      )}
    </span>
  );
}
