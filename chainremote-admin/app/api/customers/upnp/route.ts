// POST /api/customers/upnp { remoteId, enabled }
//   HQ 우클릭 "공유기 포트 열기" — remoteId 로 거래처를 찾아 on/off.
//   enabled=true 면 에이전트가 공유기에 포트 매핑을 걸고(임대 1시간, 30분마다 갱신)
//   직접 접속 리스너를 켠다. 본사는 그 주소를 연결 후보로 얹어 홀펀칭이 실패해도 직결한다.
//
//   ★기본은 off. 포트를 열면 그 POS 가 인터넷에서 도달 가능해지고, 우리는 클릭 수락 정책이라
//   표적 공격 시 영업 중인 매장 화면에 수락 카드가 뜰 수 있다. 그래서 방화벽·VAN 관제와 같이
//   거래처별로 골라 켠다(2026-08-12 Chang). viewer 차단, 남의 tenant 는 setUpnpEnabled 가 막는다.

import { requireApiAuth, requireNotViewer, jsonError, ApiAuthError } from "@/lib/api-auth";
import { setUpnpEnabled } from "@/lib/data/customers";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    requireNotViewer(me);
    const body = (await req.json().catch(() => ({}))) as {
      remoteId?: unknown;
      enabled?: unknown;
    };
    const remoteId =
      typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    if (!remoteId) throw new ApiAuthError(400, "remoteId 필수");
    const enabled = body.enabled === true;
    const ok = await setUpnpEnabled(remoteId, enabled, me.tenantId);
    if (!ok) return Response.json({ error: "거래처 없음" }, { status: 404 });
    return Response.json({ ok: true, enabled });
  } catch (e) {
    return jsonError(e);
  }
}
