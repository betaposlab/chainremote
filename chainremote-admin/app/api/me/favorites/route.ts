// GET  /api/me/favorites              → 내 즐겨찾기 (customer 정보 포함)
// POST /api/me/favorites { customerId } → 추가 (idempotent)

import { requireApiAuth, jsonError, ApiAuthError } from "@/lib/api-auth";
import * as fav from "@/lib/data/favorites";

export async function GET(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const rows = await fav.listMyFavorites(me.uid, me.tenantId);
    return Response.json({ favorites: rows });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const body = (await req.json().catch(() => ({}))) as { customerId?: unknown };
    const customerId = typeof body.customerId === "string" ? body.customerId : "";
    if (!customerId) throw new ApiAuthError(400, "customerId 필수");
    await fav.addFavorite(me.uid, customerId, me.tenantId);
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
