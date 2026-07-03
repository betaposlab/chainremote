// POST /api/customers/register-heartbeat-token  { remoteId } → { token }
//
// 에이전트가 첫 실행/heartbeat 401·403 회복 때 호출해 상태 보고용 토큰을 받는다.
// 키(auto-enroll) 없이 깐 거래처의 유일한 토큰 경로 — 이게 있어야 패널에 online/버전이 뜬다.
//   200 { token }           거래처 존재 → 토큰 발급/회전
//   409 { error: "거래처 미등록" }   패널에 아직 등록 안 됨(등록 후 재시도)
//
// 무인증(코워크 검토 H2): remote_id 만 알면 토큰을 받는다. 내부 소규모 운영 편익이 커서 일부러 열어둠 —
//   사업화(키 통일) 때 다시 막을 것. rate-limit 으로 스캔성 남용만 막는다.

import * as data from "@/lib/data/customers";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const ip = clientIp(req) ?? "unknown";
    const rl = rateLimit(`hbtoken:${ip}`, 20, 60_000);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

    const body = (await req.json().catch(() => ({}))) as { remoteId?: unknown };
    const remoteId = typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    if (!remoteId) {
      return Response.json({ error: "remoteId 필수" }, { status: 400 });
    }
    const token = await data.registerHeartbeatToken(remoteId);
    if (!token) {
      return Response.json({ error: "거래처 미등록" }, { status: 409 });
    }
    return Response.json({ token });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
