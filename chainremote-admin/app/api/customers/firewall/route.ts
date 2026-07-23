// POST /api/customers/firewall { remoteId, control }
//   HQ 우클릭 "방화벽 설정" — remoteId 로 거래처를 찾아 방화벽 자동 해제 on/off.
//   control=true 면 에이전트가 로컬에서 방화벽을 감시하다 켜지면 즉시 해제(+알림 끔).
//   기본은 off — 방화벽 꺼야 하는 메인/오더 거래처만 켠다. viewer 차단. Bearer 인증.
//   남의 tenant 거래처는 setFirewallControl 이 tenant 로 막는다.

import { requireApiAuth, requireNotViewer, jsonError, ApiAuthError } from "@/lib/api-auth";
import { setFirewallControl } from "@/lib/data/customers";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    requireNotViewer(me);
    const body = (await req.json().catch(() => ({}))) as {
      remoteId?: unknown;
      control?: unknown;
    };
    const remoteId =
      typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    if (!remoteId) throw new ApiAuthError(400, "remoteId 필수");
    const control = body.control === true;
    const ok = await setFirewallControl(remoteId, control, me.tenantId);
    if (!ok) return Response.json({ error: "거래처 없음" }, { status: 404 });
    return Response.json({ ok: true, control });
  } catch (e) {
    return jsonError(e);
  }
}
