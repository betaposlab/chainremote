// GET  /api/me/favorites              → 내 즐겨찾기 (customer 정보 포함, customer 없는 orphan 도)
// POST /api/me/favorites { remoteId } → 추가 (idempotent). 옛 { customerId } 도 후방호환.
//
// 2026-05-27 개편: remote_id 기준. customers 에 매칭되면 customer_id 도 박음.
// 매칭 안 되도 orphan 으로 즐겨찾기 가능(HQ workstation, 옵션 B+ 본사 PC 등).

import { requireApiAuth, jsonError, ApiAuthError } from "@/lib/api-auth";
import * as fav from "@/lib/data/favorites";
import { db } from "@/lib/db";
import { customers } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

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
    const body = (await req.json().catch(() => ({}))) as {
      remoteId?: unknown;
      customerId?: unknown; // 후방호환
      hostname?: unknown;
      alias?: unknown;
    };

    let remoteId = typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    const hostname = typeof body.hostname === "string" ? body.hostname.trim() || null : null;
    const alias = typeof body.alias === "string" ? body.alias.trim() || null : null;

    // 후방호환: 옛 클라이언트가 customerId 보냈으면 customers 에서 remote_id 변환.
    if (!remoteId && typeof body.customerId === "string" && body.customerId.length > 0) {
      const c = await db
        .select({ remoteId: customers.remoteId })
        .from(customers)
        .where(and(eq(customers.id, body.customerId), eq(customers.tenantId, me.tenantId)))
        .limit(1);
      if (c.length > 0 && c[0].remoteId) {
        remoteId = c[0].remoteId;
      }
    }

    if (!remoteId) {
      throw new ApiAuthError(400, "remoteId 필수");
    }

    const result = await fav.addFavoriteByRemoteId(me.uid, remoteId, me.tenantId, { hostname, alias });
    return Response.json(
      { ok: true, matchedCustomer: result.matched },
      { status: 201 },
    );
  } catch (e) {
    return jsonError(e);
  }
}
