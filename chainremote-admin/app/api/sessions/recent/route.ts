// GET /api/sessions/recent → 지원기록 타임라인 (HQ "지원 기록" 뷰, 전 직원·전 거래처).
// Bearer 인증(데스크톱 앱). 최신순, 기본 100건(?limit 로 조정).
// ?remoteId= 주면 그 거래처만 (HQ 거래처 카드 "지원이력" — HQ 는 remoteId 만 가짐).

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import * as sessions from "@/lib/data/sessions";

export async function GET(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const url = new URL(req.url);
    const limitRaw = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 500)
      : 100;
    const remoteId = url.searchParams.get("remoteId")?.trim() || undefined;
    const rows = await sessions.listRecentSessions(me.tenantId, limit, remoteId);
    return Response.json({ sessions: rows });
  } catch (e) {
    return jsonError(e);
  }
}
