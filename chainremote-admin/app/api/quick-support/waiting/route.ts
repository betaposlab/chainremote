// 본사 앱이 폴링하는 "임시 접속 대기" 목록 — 자기 대리점 것만.
// 같이 주는 code 는 그 대리점 번호(거래처에게 불러 줄 숫자)다.

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import { getQuickCode, listQuickSupportWaiting } from "@/lib/data/quick-support";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const [code, waiting] = await Promise.all([
      getQuickCode(me.tenantId),
      listQuickSupportWaiting(me.tenantId),
    ]);
    return Response.json({ code, waiting }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
