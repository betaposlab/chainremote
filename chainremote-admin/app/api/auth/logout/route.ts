// POST /api/auth/logout — 좌석 반납 (Bearer 토큰). 앱 종료 시 best-effort 호출.
// 응답: 200 { ok: true }
//
// 내 jti 인 경우에만 active 행 삭제 (이미 인계당한 뒤면 새 기기 세션을 지우지 않음).
// 스펙: docs/chainremote/SEAT_ENFORCEMENT.md §5

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import { releaseSeat } from "@/lib/data/active-sessions";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    if (me.jti) {
      await releaseSeat(me.uid, me.jti);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
