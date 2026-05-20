// POST /api/sessions { customerId }  → 내가 거래처 원격 시작 (presence)
// GET  /api/sessions/active           → 현재 활성 세션 전체 (presence 표시용)

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/schema";
import { requireApiAuth, jsonError, ApiAuthError } from "@/lib/api-auth";
import * as sessions from "@/lib/data/sessions";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const body = (await req.json().catch(() => ({}))) as { customerId?: unknown };
    const customerId = typeof body.customerId === "string" ? body.customerId : "";
    if (!customerId) throw new ApiAuthError(400, "customerId 필수");

    const customer = (
      await db
        .select({ remoteId: customers.remoteId })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, me.tenantId)))
        .limit(1)
    )[0];
    if (!customer) throw new ApiAuthError(404, "거래처 없음");

    const row = await sessions.startSession({
      tenantId: me.tenantId,
      operatorId: me.uid,
      customerId,
      remoteId: customer.remoteId,
    });
    return Response.json({ session: row }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
