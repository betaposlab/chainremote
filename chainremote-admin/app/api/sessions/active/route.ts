// GET /api/sessions/active → 테넌트 전체의 진행 중 세션 + 거래처 정보
// 본사 앱의 presence 표시: "재성이가 진희씨컴 접속중" 같은 라이브 상태.

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import * as sessions from "@/lib/data/sessions";

export async function GET(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const rows = await sessions.listActiveSessions(me.tenantId);
    return Response.json({ active: rows });
  } catch (e) {
    return jsonError(e);
  }
}
