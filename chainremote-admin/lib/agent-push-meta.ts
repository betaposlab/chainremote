// NAS 의 agent-push.json 조회 — 발행된 최신 Agent 빌드의 단일 진실 원천.
//
// 2026-07-08: /api/tenants/[id]/agent(테넌트별 오버레이 다운로드)가 별도로
// "ChainRemote_Agent_Base_vX.Y.Z.exe" 라는 이름으로 같은 빌드를 재업로드해서 쓰던 걸
// 발견 — sha256 대조 결과 Setup exe 와 100% 동일 파일이었다(그냥 복사본). 매 릴리즈마다
// 이 복사를 깜빡하면 신규 가맹점이 옛 버전으로 온보딩되는 사고가 나서(1.4.49 방치),
// 별도 "Base" 파일 관례를 폐기하고 이 한 곳만 보게 통일한다 — 발행은
// deploy/publish/publish-agent-push-meta.sh 하나면 이제 두 소비처(최신 가져오기 버튼 +
// 테넌트별 오버레이 다운로드) 다 자동으로 따라온다.

const META_CANDIDATES = [
  "https://sepani.synology.me/chainremote/agent-push.json",
  "http://192.168.68.103/chainremote/agent-push.json",
];

export type AgentPushMeta = {
  version: string;
  url: string;
  sha256: string;
  size: number;
  /** 자동 롤아웃 킬스위치 — agent-push.json 에 "auto_rollout": false 를 넣으면 전 대리점
   *  자동 큐잉을 일시 정지(수동 푸시 버튼은 계속 동작). 없으면 true. */
  autoRollout: boolean;
};

function parseMeta(j: Record<string, unknown>): AgentPushMeta | null {
  const version = typeof j.version === "string" ? j.version : "";
  const url = typeof j.url === "string" ? j.url : "";
  const sha256 = typeof j.sha256 === "string" ? j.sha256 : "";
  const size = typeof j.size === "number" ? j.size : 0;
  if (!version || !url || !sha256 || size <= 0) return null;
  const autoRollout = j.auto_rollout !== false;
  return { version, url, sha256, size, autoRollout };
}

// 자동 롤아웃용 인메모리 캐시 — heartbeat 핫패스에서 매번 NAS 를 치지 않게 60초 재사용.
// 실패도 캐시(음성 캐시)해 NAS 순단이 heartbeat 를 느리게 만들지 않는다.
let _metaCache: { at: number; meta: AgentPushMeta | null } | null = null;
export async function getAgentPushMetaCached(): Promise<AgentPushMeta | null> {
  const now = Date.now();
  if (_metaCache && now - _metaCache.at < 60_000) return _metaCache.meta;
  const r = await fetchAgentPushMetaServer();
  _metaCache = { at: now, meta: r.meta };
  return r.meta;
}

/** 서버사이드 전용(각 후보 URL 이 사설 LAN 대역 포함) — 여러 후보를 순차 시도, 에러는 함께 반환. */
export async function fetchAgentPushMetaServer(): Promise<
  { meta: AgentPushMeta } | { meta: null; errors: string[] }
> {
  const errors: string[] = [];
  for (const candidate of META_CANDIDATES) {
    try {
      const resp = await fetch(candidate, { cache: "no-store" });
      if (!resp.ok) {
        errors.push(`${candidate} → HTTP ${resp.status}`);
        continue;
      }
      const j = (await resp.json()) as Record<string, unknown>;
      const meta = parseMeta(j);
      if (!meta) {
        errors.push(`${candidate} → 형식 오류`);
        continue;
      }
      return { meta };
    } catch (e) {
      errors.push(`${candidate} → ${String(e)}`);
    }
  }
  return { meta: null, errors };
}
