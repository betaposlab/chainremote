// GET /api/customers/:id/sessions → 그 거래처의 지원 이력 (HQ 거래처 카드 "지원이력").
// Bearer 인증(데스크톱 앱). 자기 tenant 거래처만.

import { requireApiAuth, isUuid, jsonError } from "@/lib/api-auth";
import * as sessions from "@/lib/data/sessions";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(req);
    const { id } = await ctx.params;
    if (!isUuid(id))
      return Response.json({ error: "잘못된 거래처 ID" }, { status: 404 });
    const rows = await sessions.listCustomerSessions(id, me.tenantId);
    return Response.json({ sessions: rows });
  } catch (e) {
    return jsonError(e);
  }
}
