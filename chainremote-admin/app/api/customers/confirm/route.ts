// POST /api/customers/confirm  → 자가등록(⑤) 후보 거래처 확정 (owner=마스터 전용)
// body: { remoteId }  — HQ '전체 거래처' 탭에서 마스터가 미확정 후보를 확정할 때 호출.
// 정적 세그먼트 'confirm' 은 동적 '[id]' 보다 우선 매칭되므로 라우트 충돌 없음.

import {
  requireApiAuth,
  requireOwner,
  jsonError,
  ApiAuthError,
} from "@/lib/api-auth";
import * as data from "@/lib/data/customers";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    requireOwner(me); // 확정 = 마스터(owner) 전용. jaesung(admin) 등은 403.
    const body = (await req.json().catch(() => ({}))) as { remoteId?: unknown };
    const remoteId =
      typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    if (!remoteId) throw new ApiAuthError(400, "remoteId 필수");
    const ok = await data.confirmEnrollmentByRemoteId(remoteId, {
      tenantId: me.tenantId,
    });
    // 이미 active 거나 해당 후보가 없으면 ok=false (멱등 — 에러 아님).
    return Response.json({ ok });
  } catch (e) {
    return jsonError(e);
  }
}
