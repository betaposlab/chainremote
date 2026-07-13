// POST /api/sessions/:id/discard → HQ 가 아주 짧은 오접속(<15초, 실제 연결 안 됨)을 폐기.
//   이력 노이즈 방지 — 세션 레코드 자체를 삭제. Bearer 인증, 자기 tenant 만.

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import * as sessions from "@/lib/data/sessions";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(_req);
    const { id } = await ctx.params;
    await sessions.discardSession(id, me.tenantId);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
