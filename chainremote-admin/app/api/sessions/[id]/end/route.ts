// POST /api/sessions/:id/end → 본사 앱이 원격 창 닫을 때 호출.
// body 없음 — 메모/장애유형 등은 패널에서 사후 수정(updateSession server action).

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import * as sessions from "@/lib/data/sessions";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(req);
    const { id } = await ctx.params;
    await sessions.endSession(id, me.tenantId);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
