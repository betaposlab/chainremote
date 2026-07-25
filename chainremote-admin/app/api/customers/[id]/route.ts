// GET    /api/customers/:id  → 단일 조회 (전 직원)
// PATCH  /api/customers/:id  → 수정 (직원 포함 전원 — 3역할 체계 2026-07-25)
// DELETE /api/customers/:id  → 삭제 (직원 포함 전원)
//   거래처 작업은 다 열고 계정 관리만 막는 게 확정 정책. 종전 owner 전용 게이트는
//   super_admin 을 빼먹어 owner 없는 회사의 Chang 이 403 을 받던 결함도 함께 해소된다.

import {
  requireApiAuth,
  requireNotViewer,
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
    requireNotViewer(me);
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
    requireNotViewer(me);
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
