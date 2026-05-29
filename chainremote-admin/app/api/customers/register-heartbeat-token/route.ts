// POST /api/customers/register-heartbeat-token
//
// Agent 가 첫 실행 시 + heartbeat 401/403 회복 시 호출. customer 매칭되면 무조건
// 새 토큰 발급(rotation) + DB 갱신 + 반환. v1.3.7 부터 idempotent — 이전 1회 제약은
// Agent LocalConfig 토큰 분실 시 영구 stuck 의 진짜 원인이라 폐기.
//
// 인증: 없음 (의도). 자세히는 lib/data/customers.ts::registerHeartbeatToken doc.
//
// 호출 예 (Rust agent):
//   POST https://sepani.synology.me:3001/api/customers/register-heartbeat-token
//   Content-Type: application/json
//   { "remoteId": "129264698" }
//
//   200 → { "token": "<64 hex>" }  ← customer 존재. 새 토큰 발급/회전
//   409 → { "error": "거래처 미등록" }  ← Chang 이 패널에 미등록 (등록 후 재시도)

import * as data from "@/lib/data/customers";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { remoteId?: unknown };
    const remoteId =
      typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    if (!remoteId) {
      return Response.json({ error: "remoteId 필수" }, { status: 400 });
    }
    const token = await data.registerHeartbeatToken(remoteId);
    if (!token) {
      return Response.json(
        { error: "거래처 미등록" },
        { status: 409 },
      );
    }
    return Response.json({ token });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
