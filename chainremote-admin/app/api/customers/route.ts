// GET  /api/customers  → 테넌트 내 전체 거래처 (전 직원)
// POST /api/customers  → 신규 거래처 등록 (전 직원 — 결정 #7)

import { requireApiAuth, jsonError, ApiAuthError, stripNul } from "@/lib/api-auth";
import * as data from "@/lib/data/customers";

export async function GET(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const rows = await data.listCustomers(me.tenantId);
    return Response.json({ customers: rows });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const body = (await req.json().catch(() => ({}))) as Partial<data.CustomerFields>;
    const name = typeof body.name === "string" ? stripNul(body.name).trim() : "";
    if (!name) throw new ApiAuthError(400, "name 필수");
    const row = await data.createCustomer(
      {
        name,
        contactName: nullable(body.contactName),
        phone: nullable(body.phone),
        address: nullable(body.address),
        remoteId: nullable(body.remoteId),
        accessPassword: nullable(body.accessPassword),
        notes: nullable(body.notes),
      },
      { tenantId: me.tenantId, assignedUserId: me.uid },
    );
    return Response.json({ customer: row }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

function nullable(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // NUL 제거(2026-08-16) — 넣으면 INSERT 가 터지며 응답에 SQL 이 샜다(CWE-209).
  const t = stripNul(v).trim();
  return t === "" ? null : t;
}
