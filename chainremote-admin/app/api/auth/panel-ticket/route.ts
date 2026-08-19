// POST /api/auth/panel-ticket → 본사 앱이 자기 신원으로 '관리 패널 한 번 열기' 티켓을 받는다.
// Bearer 인증(HQ 데스크톱 앱). 반환한 티켓을 주소에 실어 브라우저로 열면 같은 계정으로 패널이 열린다.
//
// ★티켓은 앱이 이미 증명한 신원을 그대로 옮기는 것이지 새 권한이 아니다. 발급 대상은 오직
//   Bearer 토큰의 주인(uid)이고, 요청 본문에서 사용자를 받지 않는다 — 받으면 그 순간
//   "아무나 지정한 계정으로 패널을 여는" 통로가 된다.

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import { issuePanelTicket } from "@/lib/panel-ticket";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const ticket = await issuePanelTicket(me.uid);
    return Response.json({ ticket });
  } catch (e) {
    return jsonError(e);
  }
}
