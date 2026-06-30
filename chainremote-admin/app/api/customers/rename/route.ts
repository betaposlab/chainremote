// POST /api/customers/rename  { remoteId, name }
// HQ 어느 직원이든 거래처명을 바꾸면 패널 DB(customer.name, 진실원천)에 기록 →
//   최근세션·즐겨찾기·패널·전 직원·양쪽 HQ 모두 같은 이름으로 수렴. owner 게이트 없음(전 직원).
// 정적 세그먼트 'rename' 은 동적 '[id]' 보다 우선 매칭되므로 라우트 충돌 없음.

import { requireApiAuth, jsonError, ApiAuthError } from "@/lib/api-auth";
import * as data from "@/lib/data/customers";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const body = (await req.json().catch(() => ({}))) as {
      remoteId?: unknown;
      name?: unknown;
    };
    const remoteId = typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!remoteId) throw new ApiAuthError(400, "remoteId 필수");
    if (!name) throw new ApiAuthError(400, "name 필수");
    const ok = await data.renameCustomerByRemoteId(remoteId, name, {
      tenantId: me.tenantId,
    });
    // ok=false = 그 remote_id 가 이 테넌트 거래처가 아님(orphan) → HQ 는 로컬 alias 유지.
    return Response.json({ ok });
  } catch (e) {
    return jsonError(e);
  }
}
