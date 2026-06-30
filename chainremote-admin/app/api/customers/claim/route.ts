// POST /api/customers/claim  { remoteId }
// ③ 신규(미배정) 거래처를 먼저 클릭/원격한 직원이 자동으로 차지 — first-wins:
//   미배정(assigned_user_id NULL)이면 그 직원에게 배정 + 그 직원 즐겨찾기에 자동 등록.
//   이미 배정됐으면 무변경(claimed:false). HQ 가 연결 시 fire-and-forget 호출.
// 정적 세그먼트 'claim' 은 동적 '[id]' 보다 우선 매칭.

import { requireApiAuth, jsonError, ApiAuthError } from "@/lib/api-auth";
import * as data from "@/lib/data/customers";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const body = (await req.json().catch(() => ({}))) as { remoteId?: unknown };
    const remoteId = typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    if (!remoteId) throw new ApiAuthError(400, "remoteId 필수");
    const r = await data.claimCustomerByRemoteId(remoteId, {
      tenantId: me.tenantId,
      userId: me.uid,
    });
    return Response.json(r);
  } catch (e) {
    return jsonError(e);
  }
}
