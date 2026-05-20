// GET /api/me/sessions/recent?limit=30 → 내가 최근에 접속한 세션 N개 (거래처 정보 포함)

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import * as sessions from "@/lib/data/sessions";

export async function GET(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const url = new URL(req.url);
    const limitParam = Number(url.searchParams.get("limit") ?? "30");
    const limit = Math.min(Math.max(1, Number.isFinite(limitParam) ? limitParam : 30), 100);
    const rows = await sessions.listMyRecentSessions(me.uid, me.tenantId, limit);
    return Response.json({ sessions: rows });
  } catch (e) {
    return jsonError(e);
  }
}
