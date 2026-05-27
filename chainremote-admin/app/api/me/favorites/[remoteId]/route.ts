// DELETE /api/me/favorites/:remoteId → 내 즐겨찾기 제거 (idempotent).
// 2026-05-27 개편: remote_id 기준. customers 에 없는 머신(HQ workstation)도 제거 가능.

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import * as fav from "@/lib/data/favorites";

type Ctx = { params: Promise<{ remoteId: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(req);
    const { remoteId } = await ctx.params;
    await fav.removeFavoriteByRemoteId(me.uid, remoteId);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
