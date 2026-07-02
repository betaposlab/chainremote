// in-memory 슬라이딩 윈도우 rate-limiter.
// 인증/토큰 엔드포인트의 brute-force·스캔 방어용(로그인 비번 대입, register-heartbeat-token
// 의 remote_id 스캔). 단일 NAS Node 프로세스라 모듈 전역 상태가 요청 간 살아있다(서버리스 아님).
// 재시작하면 리셋되지만 감수. 다중 인스턴스로 가면 PG/Redis 로 교체.

const buckets = new Map<string, number[]>();
let lastSweep = 0;

function sweep(now: number) {
  // 메모리 바운드: 1분에 한 번 오래된 빈 버킷 정리.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, arr] of buckets) {
    if (arr.length === 0 || now - arr[arr.length - 1] > 600_000) buckets.delete(k);
  }
}

/**
 * key 단위로 windowMs 동안 limit 회까지 허용. 초과면 allowed=false + retryAfterSec.
 * 허용 시에만 카운트(거부된 시도는 윈도우를 더 늘리지 않음).
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - arr[0])) / 1000));
    return { allowed: false, retryAfterSec };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { allowed: true, retryAfterSec: 0 };
}

/** 429 Too Many Requests 응답 헬퍼. */
export function tooManyRequests(retryAfterSec: number): Response {
  return Response.json(
    { error: "요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", retryAfter: retryAfterSec },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
