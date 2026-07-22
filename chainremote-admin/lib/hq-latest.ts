// NAS 의 latest.json(hq 채널) 조회 — 발행된 최신 HQ 빌드의 단일 진실 원천.
//
// Agent 와 결정적으로 다른 점: HQ 설치본에는 대리점 식별자가 없다(custom-hq.txt 에
// tenant-slug/enroll-key 가 아예 없음). 어느 대리점이 되는지는 실행 후 로그인으로만
// 갈린다 — 그래서 한 벌을 누구에게 줘도 되고, 테넌트별 오버레이도 필요 없다.
//
// 버전을 링크에 박지 않는 이유: 박아두면 릴리즈 때마다 사람이 고쳐야 하고, 빠뜨리면
// 그 채널만 옛 버전으로 굳는다(영업 랜딩이 v1.4.16 으로 6주 방치된 그 사고). 여기서
// 매번 latest.json 을 보고 최신으로 넘긴다.

const LATEST_CANDIDATES = [
  "https://sepani.synology.me/chainremote/latest.json",
  "http://192.168.68.103/chainremote/latest.json",
];

export type HqLatest = {
  version: string;
  url: string;
  sha256: string;
  size: number;
};

function parseHq(j: Record<string, unknown>): HqLatest | null {
  const hq = j.hq as Record<string, unknown> | undefined;
  if (!hq || typeof hq !== "object") return null;
  const version = typeof hq.version === "string" ? hq.version : "";
  const url = typeof hq.url === "string" ? hq.url : "";
  const sha256 = typeof hq.sha256 === "string" ? hq.sha256 : "";
  const size = typeof hq.size === "number" ? hq.size : 0;
  if (!version || !url || !sha256 || size <= 0) return null;
  return { version, url, sha256, size };
}

/** 서버사이드 전용(후보에 사설 LAN 대역 포함) — 순차 시도, 에러는 함께 반환. */
export async function fetchHqLatestServer(): Promise<
  { meta: HqLatest } | { meta: null; errors: string[] }
> {
  const errors: string[] = [];
  for (const candidate of LATEST_CANDIDATES) {
    try {
      const resp = await fetch(candidate, { cache: "no-store" });
      if (!resp.ok) {
        errors.push(`${candidate} → HTTP ${resp.status}`);
        continue;
      }
      const j = (await resp.json()) as Record<string, unknown>;
      const meta = parseHq(j);
      if (!meta) {
        errors.push(`${candidate} → hq 채널 형식 오류`);
        continue;
      }
      return { meta };
    } catch (e) {
      errors.push(`${candidate} → ${String(e)}`);
    }
  }
  return { meta: null, errors };
}
