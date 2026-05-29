// GET  /api/customers/pending-update — Agent 폴링 (대기 중 푸시 1건 조회)
// POST /api/customers/pending-update — Agent 의 설치 완료/실패 보고
//
// 둘 다 인증: X-ChainRemote-Token 헤더 + remoteId (heartbeat 와 동일 패턴).
//
// 호출 예 (Rust agent, 5분 주기):
//   GET https://sepani.synology.me:3001/api/customers/pending-update?remoteId=129264698
//   X-ChainRemote-Token: <64 hex>
//
//   200 (대기 있음) → {
//     "id": "uuid",
//     "targetVersion": "1.3.5",
//     "assetUrl": "https://...",
//     "assetSha256": "...",
//     "assetSize": 12345678,
//     "windowStartHour": 0,
//     "windowEndHour": 7,
//     "randomizeMaxSec": 25200
//   }
//   200 (대기 없음) → { "id": null }
//   401 → token 헤더 누락
//   403 → token / remoteId 불일치
//
// 적용/실패 보고:
//   POST 본문 { "id": "uuid", "remoteId": "...", "status": "applied" | "failed", "reason": "..." }

import * as data from "@/lib/data/pending-updates";

export async function GET(req: Request) {
  try {
    const token = req.headers.get("X-ChainRemote-Token");
    if (!token) {
      return Response.json({ error: "token 헤더 필수" }, { status: 401 });
    }
    const url = new URL(req.url);
    const remoteId = (url.searchParams.get("remoteId") ?? "").trim();
    if (!remoteId) {
      return Response.json({ error: "remoteId 필수" }, { status: 400 });
    }
    const row = await data.getPendingForAgent(remoteId, token);
    if (!row) {
      // 매칭 자체는 잠재적으로 OK 인데 (token 정상) 대기 push 가 없는 케이스 vs token 불일치.
      // Agent 단순화 위해 대기 없음/불일치 둘 다 200 { id: null } 로 통일.
      // 진짜 권한 오류는 GET 으론 구분 안 됨 (응답이 동일) — 보안상 비교 사이드채널 노출 안 함.
      return Response.json({ id: null });
    }
    return Response.json(row);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const token = req.headers.get("X-ChainRemote-Token");
    if (!token) {
      return Response.json({ error: "token 헤더 필수" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      id?: unknown;
      remoteId?: unknown;
      status?: unknown;
      reason?: unknown;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const remoteId = typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    const status = typeof body.status === "string" ? body.status.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!id || !remoteId || (status !== "applied" && status !== "failed")) {
      return Response.json({ error: "id + remoteId + status(applied|failed) 필수" }, { status: 400 });
    }
    const ok =
      status === "applied"
        ? await data.markApplied(id, remoteId, token)
        : await data.markFailed(id, remoteId, token, reason || "unknown");
    if (!ok) {
      return Response.json({ error: "매칭 실패 또는 이미 처리됨" }, { status: 403 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
