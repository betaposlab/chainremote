// 리버스 프록시(Synology/docker) 뒤 실제 클라이언트 IP 추출 — 표시/감사용(비필수).
// active_login_sessions.ip 에 저장해 "어느 IP 에서 점유 중" 표시. NULL 허용.
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // "client, proxy1, proxy2" → 첫 홉(실제 클라이언트).
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip");
}
