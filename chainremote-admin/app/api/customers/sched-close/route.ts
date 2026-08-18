// POST /api/customers/sched-close {remoteId} → 그 거래처의 예약원격 창을 닫으라고 큐잉.
// Bearer 인증(HQ 데스크톱 앱). 에이전트가 다음 heartbeat(≤10분)에 받아 창을 닫는다.
//
// ★즉시 닫히지 않는다. 패널·HQ 목록에서 거래처로 가는 실시간 통로가 없어(hbbs 는 우리
//   명령을 실어 나르지 않는다) 하트비트 응답에 실려 내려간다. 원격 중이라면 그 세션으로
//   바로 보내는 길이 따로 있다(툴바/세션 종료 체크박스) — 그쪽은 확인까지 받는다.
//
// 권한은 디스크 정리와 같은 등급(viewer 제외)이다. 이 명령은 접근 권한을 **줄이기만**
//   하므로 여는 쪽(거래처 사장님의 손)보다 낮은 문턱이 맞다.

import { requireApiAuth, requireNotViewer, jsonError } from "@/lib/api-auth";
import * as data from "@/lib/data/customers";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    requireNotViewer(me);
    const body = (await req.json().catch(() => ({}))) as { remoteId?: unknown };
    const remoteId =
      typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    if (!remoteId) {
      return Response.json({ error: "remoteId 필수" }, { status: 400 });
    }
    const ok = await data.requestSchedClose(remoteId, { tenantId: me.tenantId });
    if (!ok) {
      // 이제 여기 오는 건 "그 거래처가 우리 대리점에 없다" 뿐이다. 열린 예약이 있는지는
      //   묻지 않는다 — 우리가 아는 예약 상태가 하트비트만큼 늦어, 그걸 조건으로 걸면
      //   방금 건 예약을 취소하려는 기사를 서버가 거절한다.
      return Response.json({ error: "거래처 없음" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
