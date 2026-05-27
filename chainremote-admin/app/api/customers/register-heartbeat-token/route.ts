// POST /api/customers/register-heartbeat-token
//
// Agent 가 첫 실행 시 호출. customers.heartbeat_token 이 NULL 일 때만 새 토큰 생성·반환.
// 이미 등록되어 있거나 remote_id 매칭 customer 없으면 409.
//
// 인증: 없음 (의도). 사업화 초기 보안 모델은 "1회 제약" 만으로 충분 — 자세히는
// lib/data/customers.ts::registerHeartbeatToken 의 doc.
//
// 호출 예 (Rust agent):
//   POST https://sepani.synology.me:3001/api/customers/register-heartbeat-token
//   Content-Type: application/json
//   { "remoteId": "129264698" }
//
//   200 → { "token": "<64 hex>" }
//   409 → { "error": "이미 등록됨 또는 거래처 미등록" }

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
        { error: "이미 등록됨 또는 거래처 미등록" },
        { status: 409 },
      );
    }
    return Response.json({ token });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
