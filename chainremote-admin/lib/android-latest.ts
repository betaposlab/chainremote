// NAS 의 android.json 조회 — 발행된 최신 안드로이드 HQ(APK)의 단일 진실 원천.
//
// latest.json(hq 채널)과 파일을 나눈 이유: latest.json 은 Windows HQ 의 자동 업데이트가
// 24h 마다 읽는 파일이라, 거기에 키를 보태다 형식이 틀어지면 50대 HQ 의 업데이트가
// 한 번에 멈춘다. 안드로이드는 자동 업데이트 경로가 없어(스토어 밖 APK) 별도 파일이
// 잃을 것이 없다. 한 벌을 누구에게 줘도 되는 점은 HQ 와 같다(대리점 식별자 없음).
//
// 버전을 링크에 박지 않는 이유는 hq-latest.ts 와 같다 — 박아두면 그 채널만 옛 버전으로 굳는다.

const CANDIDATES = [
  "https://sepani.synology.me/chainremote/android.json",
  "http://192.168.68.103/chainremote/android.json",
];

export type AndroidLatest = {
  version: string;
  url: string;
  sha256: string;
  size: number;
};

export function parseAndroidLatest(j: Record<string, unknown>): AndroidLatest | null {
  const version = typeof j.version === "string" ? j.version : "";
  const url = typeof j.url === "string" ? j.url : "";
  const sha256 = typeof j.sha256 === "string" ? j.sha256 : "";
  const size = typeof j.size === "number" ? j.size : 0;
  if (!version || !url || !sha256 || size <= 0) return null;
  return { version, url, sha256, size };
}

/** 서버사이드 전용(후보에 사설 LAN 대역 포함) — 순차 시도, 에러는 함께 반환. */
export async function fetchAndroidLatestServer(): Promise<
  { meta: AndroidLatest } | { meta: null; errors: string[] }
> {
  const errors: string[] = [];
  for (const candidate of CANDIDATES) {
    try {
      const resp = await fetch(candidate, { cache: "no-store" });
      if (!resp.ok) {
        errors.push(`${candidate} → HTTP ${resp.status}`);
        continue;
      }
      const j = (await resp.json()) as Record<string, unknown>;
      const meta = parseAndroidLatest(j);
      if (!meta) {
        errors.push(`${candidate} → android.json 형식 오류`);
        continue;
      }
      return { meta };
    } catch (e) {
      errors.push(`${candidate} → ${String(e)}`);
    }
  }
  return { meta: null, errors };
}
