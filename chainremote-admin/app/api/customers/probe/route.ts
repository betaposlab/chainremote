// POST /api/customers/probe { results: [{ remoteId, direct, ms }] }
//   HQ 가 거래처를 한 바퀴 돌며 "연결만 해 보고 끊은" 결과를 올린다(마이그043).
//
//   왜 HQ 가 재고 서버가 받기만 하나: 클라우드는 공인 IP 에 NAT 가 없어서 거기서 재면
//   실제보다 낙관적인 숫자가 나온다. 진짜 원격은 사무실 NAT ↔ 거래처 NAT 조합이라
//   지원을 실제로 하는 그 기기, 그 회선에서 재야 의미가 있다.
//
//   viewer 차단. 남의 tenant 거래처는 recordProbeResults 가 tenantId 로 막는다.

import { requireApiAuth, requireNotViewer, jsonError, ApiAuthError } from "@/lib/api-auth";
import { recordProbeResults } from "@/lib/data/customers";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    requireNotViewer(me);
    const body = (await req.json().catch(() => ({}))) as { results?: unknown };
    if (!Array.isArray(body.results)) throw new ApiAuthError(400, "results 배열 필수");
    const rows = body.results
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x?.remoteId === "string")
      .map((x) => ({
        remoteId: String(x.remoteId).trim(),
        // 연결 실패(null)도 기록한다 — "꺼져 있어서 못 쟀다"와 "재 봤더니 릴레이"는 다르다.
        direct: typeof x.direct === "boolean" ? x.direct : null,
        ms: typeof x.ms === "number" ? x.ms : 0,
      }));
    const updated = await recordProbeResults(me.tenantId, rows);
    return Response.json({ ok: true, updated, received: rows.length });
  } catch (e) {
    return jsonError(e);
  }
}
