// POST /api/customers/cleanup {remoteId} → 그 거래처에 디스크 정리 명령 큐잉.
// Bearer 인증(HQ 데스크톱 앱). 에이전트가 다음 heartbeat(≤10분)에 받아
// Temp(전 프로필+윈도우)+휴지통을 영구삭제로 비우고 결과를 보고한다.

import { requireApiAuth, requireNotViewer, jsonError } from "@/lib/api-auth";
import * as data from "@/lib/data/customers";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    requireNotViewer(me); // 디스크 정리 = Temp·휴지통 영구삭제 명령 — 읽기 계정 차단.
    const body = (await req.json().catch(() => ({}))) as { remoteId?: unknown };
    const remoteId =
      typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    if (!remoteId) {
      return Response.json({ error: "remoteId 필수" }, { status: 400 });
    }
    const ok = await data.requestCleanup(remoteId, { tenantId: me.tenantId });
    if (!ok) {
      return Response.json({ error: "거래처 없음" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
