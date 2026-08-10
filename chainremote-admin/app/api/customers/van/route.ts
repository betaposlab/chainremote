// POST /api/customers/van { remoteId, kind }
//   HQ 우클릭 "카드결제 데몬 관제" — remoteId 로 거래처를 찾아 감시할 VAN 종류를 설정한다.
//   kind='' 면 관제 해제(기본), 'ksnet' 이면 에이전트가 KSCAT 의 27015 를 감시하다 닫히면
//   데몬을 되살린다. 거래처마다 VAN 사가 다르므로 켠 곳에만 적용된다. viewer 차단, Bearer 인증.
//   남의 tenant 거래처는 setVanWatch 가 tenant 로 막는다.

import { requireApiAuth, requireNotViewer, jsonError, ApiAuthError } from "@/lib/api-auth";
import { setVanWatch } from "@/lib/data/customers";
import { VAN_KINDS } from "@/lib/van-constants";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    requireNotViewer(me);
    const body = (await req.json().catch(() => ({}))) as {
      remoteId?: unknown;
      kind?: unknown;
    };
    const remoteId =
      typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    if (!remoteId) throw new ApiAuthError(400, "remoteId 필수");
    const kind = typeof body.kind === "string" ? body.kind.trim() : "";
    // 모르는 값을 넣으면 에이전트가 조용히 아무것도 안 해 "켰는데 안 된다"가 된다. 여기서 막는다.
    if (kind && !VAN_KINDS.some((v) => v.kind === kind)) {
      throw new ApiAuthError(400, "지원하지 않는 VAN");
    }
    const ok = await setVanWatch(remoteId, kind, me.tenantId);
    if (!ok) return Response.json({ error: "거래처 없음" }, { status: 404 });
    return Response.json({ ok: true, kind });
  } catch (e) {
    return jsonError(e);
  }
}
