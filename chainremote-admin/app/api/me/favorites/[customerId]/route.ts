// DELETE /api/me/favorites/:customerId → 내 즐겨찾기 제거 (idempotent)

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import * as fav from "@/lib/data/favorites";

type Ctx = { params: Promise<{ customerId: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(req);
    const { customerId } = await ctx.params;
    await fav.removeFavorite(me.uid, customerId);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
