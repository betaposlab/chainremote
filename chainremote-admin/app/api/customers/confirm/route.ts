// POST /api/customers/confirm  → auto-enroll pending 후보를 active 로 확정.
// HQ '전체 거래처' 탭에서 미확정 후보를 확정할 때 호출.
// 정적 세그먼트 'confirm' 이 동적 '[id]' 보다 먼저 매칭되므로 라우트 충돌 없음.
// 3역할 체계(2026-07-25): 직원 포함 전원 허용 — 거래처 작업은 계정 관리와 달리 다 연다.
//   종전 owner 전용 게이트는 super_admin 을 빼먹어 Chang 의 HQ 가 403 을 받던 결함이 있었다.

import { requireApiAuth, requireNotViewer, jsonError, ApiAuthError } from "@/lib/api-auth";
import * as data from "@/lib/data/customers";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    requireNotViewer(me);
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
