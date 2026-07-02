// GET    /api/customers/:id  → 단일 조회 (전 직원)
// PATCH  /api/customers/:id  → 수정 (owner 만 — 결정 #7)
// DELETE /api/customers/:id  → 삭제 (owner 만)

import {
  requireApiAuth,
  requireOwner,
  jsonError,
  ApiAuthError,
} from "@/lib/api-auth";
import * as data from "@/lib/data/customers";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(req);
    const { id } = await ctx.params;
    const row = await data.getCustomer(id, me.tenantId);
    if (!row) throw new ApiAuthError(404, "not found");
    return Response.json({ customer: row });
  } catch (e) {
    return jsonError(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(req);
    requireOwner(me);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Partial<data.CustomerFields>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiAuthError(400, "name 필수");
    const row = await data.updateCustomer(
      id,
      {
        name,
        contactName: nullable(body.contactName),
        phone: nullable(body.phone),
        address: nullable(body.address),
        remoteId: nullable(body.remoteId),
        accessPassword: nullable(body.accessPassword),
        notes: nullable(body.notes),
      },
      { tenantId: me.tenantId },
    );
    if (!row) throw new ApiAuthError(404, "not found");
    return Response.json({ customer: row });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(req);
    requireOwner(me);
    const { id } = await ctx.params;
    const ok = await data.deleteCustomer(id, { tenantId: me.tenantId });
    if (!ok) throw new ApiAuthError(404, "not found");
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

function nullable(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
