// 거래처 상태 — 마지막 heartbeat 상대시각 + 버전 + 색상 + 업데이트 건강도(brick 감지).
//
// heartbeat 색상: 10분 이내 녹색, 1시간 이내 주황, 그 이상/미보고 빨강,
// heartbeat 0건이면 회색(옛 binary 거나 등록 직후).
//
// 업데이트 건강도 (자동업데이트 brick 가시화, 2026-06-05):
//   에이전트는 설치를 "실행"만 해도 완료 확인 전에 곧장 applied 를 보고한다. 그 뒤 설치가
//   깨지면(copy 실패 등) 패널엔 성공, 거래처는 사망(brick) 상태가 된다. heartbeat 버전이
//   push 목표 버전까지 안 올라오면 그 어긋남을 여기서 드러낸다.
//   failed=명시적 실패 보고 / brick=applied 후 GRACE 지나도 버전 정체 / pending=GRACE 내 /
//   ok=heartbeat 버전이 목표 이상.

export const BRICK_GRACE_MIN = 20; // applied 후 이만큼 지나도 버전 안 오르면 brick 의심 (heartbeat 2주기 여유)

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

// 현재 버전이 목표보다 낮은지. null(미보고)은 낮음으로 취급. 목표 이상이면 정상으로 보므로
// 이후 더 새 버전을 받은 경우(예: 우리집)도 정상.
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

// 순수 함수라 배지 컴포넌트와 페이지 요약 카운트가 같은 판정을 공유한다.
export function computeUpdateHealth(
  update: UpdateInfo | undefined,
  lastVersion: string | null,
): UpdateHealth {
  if (!update) return null;
  if (update.failedAt)
    return { kind: "failed", targetVersion: update.targetVersion, failureReason: update.failureReason ?? null };
  if (update.appliedAt) {
    // 현재 버전이 목표 이상이면 정상 적용 (이후 다른 업뎃 받은 경우 포함).
    if (!isOlder(lastVersion, update.targetVersion)) {
      return { kind: "ok", targetVersion: update.targetVersion };
    }
    // "적용됨" 보고됐는데 버전은 그대로 = 의심.
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
  // 내부 기기(본사/Mac/빌드머신)는 자동업뎃 대상이 아니라 상태 칸을 통째로 비운다.
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

// HQ 본사앱 직원 상태 — CustomerStatus 의 HQ 판. 마지막 접속 + HQ 버전 + 옛버전 경고.
// lastHeartbeatAt 은 서버→클라 직렬화된 ISO 문자열. targetVersion(최신 발행 HQ 버전)이 null이면 비교 생략.
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
      <span className="chip chip-warn">
        ⚠ 옛 버전 (최신 v{targetVersion})
      </span>
    </div>
  );
}

function UpdateBadge({ health }: { health: NonNullable<UpdateHealth> }) {
  if (health.kind === "ok") return null;
  if (health.kind === "pending") {
    return (
      <span className="chip chip-accent w-fit">
        <span className="h-1.5 w-1.5 rounded-full bg-[#4c7dff] animate-pulse" />
        업뎃 적용중 v{health.targetVersion}
      </span>
    );
  }
  if (health.kind === "failed") {
    return (
      <span
        className="chip chip-danger w-fit"
        title={health.failureReason ?? undefined}
      >
        ⚠ 업뎃 실패 v{health.targetVersion}
      </span>
    );
  }
  // brick
  return (
    <span
      className="chip chip-danger-solid w-fit"
      title={`푸시 적용 보고 후 ${health.ageMin}분 지나도록 v${health.targetVersion} heartbeat 미수신 — 설치 실패/brick 의심. 거래처 PC 점검 필요(RDP/현장).`}
    >
      ⚠ 업뎃 미확인 v{health.targetVersion}
    </span>
  );
}

function renderHeartbeat(lastHeartbeatAt: Date | null, lastVersion: string | null) {
  if (!lastHeartbeatAt) {
    return (
      <span className="inline-flex items-center gap-1 text-[#838aa4]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#5c6480]" />
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
    color === "green" ? "bg-[#3ddc84]" : color === "amber" ? "bg-amber-400" : "bg-[#ff6b6f]";
  const textClass =
    color === "green" ? "text-[#3ddc84]" : color === "amber" ? "text-amber-300" : "text-[#ffb3b6]";

  return (
    <span className={`inline-flex items-center gap-1.5 ${textClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      <span className="font-mono">{label}</span>
      {lastVersion && (
        <span className="text-[10px] tabular-nums text-[#838aa4]">v{lastVersion}</span>
      )}
    </span>
  );
}
