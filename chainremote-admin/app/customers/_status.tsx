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

/** 이보다 오래 보고가 없으면 "요청 수신 불가" 값을 믿지 않는다 — 그 상태로 PC 를 끄면
 *  서버엔 옛 값이 남는다(본사 앱 crRzNoReplySince 와 같은 문턱). */
export const RZ_NOREPLY_FRESH_MIN = 15;

/**
 * 원격 요청이 닿지 않는 상태인가(마이그 055). 그렇다면 몇 분째인지, 아니면 null.
 *
 * 에이전트가 접속 서버의 답장을 못 받는 동안 heartbeat 에 시작 시각을 실어 보낸다. 그 PC 는
 * 켜져 있고 보고도 오지만 원격을 걸면 실패한다 — 수락 카드도 안 뜬다.
 */
export function rzNoReplyMinutes(
  rzNoreplySince: Date | string | null | undefined,
  lastHeartbeatAt: Date | string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!rzNoreplySince || !lastHeartbeatAt) return null;
  const hb = new Date(lastHeartbeatAt).getTime();
  const since = new Date(rzNoreplySince).getTime();
  if (!Number.isFinite(hb) || !Number.isFinite(since)) return null;
  if (now - hb >= RZ_NOREPLY_FRESH_MIN * 60_000) return null;
  return Math.max(0, Math.floor((now - since) / 60_000));
}

export function CustomerStatus({
  lastHeartbeatAt,
  lastVersion,
  update,
  isInternal = false,
  rzNoreplySince = null,
}: {
  lastHeartbeatAt: Date | null;
  lastVersion: string | null;
  update?: UpdateInfo;
  isInternal?: boolean;
  rzNoreplySince?: Date | null;
}) {
  // 내부 기기(본사/Mac/빌드머신)는 자동업뎃 대상이 아니라 상태 칸을 통째로 비운다.
  if (isInternal) {
    return null;
  }

  const health = computeUpdateHealth(update, lastVersion);

  const heartbeat = renderHeartbeat(lastHeartbeatAt, lastVersion);

  // 보고는 오는데 원격 요청이 안 닿는 상태 — 초록 "방금" 옆에 따로 띄운다. 초록만 보면
  //   붙을 수 있는 줄 안다.
  const noReplyMin = rzNoReplyMinutes(rzNoreplySince, lastHeartbeatAt);
  const noReply =
    noReplyMin === null ? null : (
      <span
        className="inline-flex w-fit items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-300"
        title={
          "컴퓨터는 켜져 있지만 원격 요청이 닿지 않습니다. 지금 접속하면 실패합니다.\n" +
          "거래처에서 그 컴퓨터를 한 번 사용하면(마우스·화면 터치) 풀리는 경우가 있습니다."
        }
      >
        ⚠ 요청 수신 불가 ·{" "}
        {noReplyMin < 60 ? `${noReplyMin}분째` : `${Math.floor(noReplyMin / 60)}시간째`}
      </span>
    );

  const showUpdate = !!health && health.kind !== "ok";
  if (!showUpdate && !noReply) {
    return heartbeat;
  }

  return (
    <div className="flex flex-col gap-1">
      {heartbeat}
      {noReply}
      {showUpdate && <UpdateBadge health={health} />}
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
      <span className="inline-flex items-center gap-1 text-[#ccd2e3]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#7d84a0]" />
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
        <span className="text-[10px] tabular-nums text-[#ccd2e3]">v{lastVersion}</span>
      )}
    </span>
  );
}
