// POST /api/sessions/:id/end → 본사 앱(HQ)이 원격 창 닫을 때 호출.
// body 전부 선택적(HQ 종료 모달에서 안 적거나 스킵 가능): categories(A/S 종류 콤마조인),
//   description(내용), contactName(거래처측 응대자), resolution(처리결과), connDirect(직결/릴레이).
//   시간·duration 은 자동.

import { requireApiAuth, isUuid, jsonError } from "@/lib/api-auth";
import * as sessions from "@/lib/data/sessions";

type Ctx = { params: Promise<{ id: string }> };

const RESOLUTIONS = ["resolved", "pending", "escalated", "in_progress"] as const;

// Postgres text 컬럼은 NUL(U+0000) 을 저장 못 해 쿼리가 터지고, 그 에러에 SQL 이 실려 샜다.
// 문자열 필드에서 NUL 을 제거한다(소스에 리터럴 제어문자를 두지 않으려 fromCharCode 사용).
// trim/빈값 처리는 데이터 레이어(endSession)가 담당.
const NUL = String.fromCharCode(0);
const clean = (v: unknown) =>
  typeof v === "string" ? v.split(NUL).join("") : undefined;

export async function POST(req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(req);
    const { id } = await ctx.params;
    if (!isUuid(id))
      return Response.json({ error: "잘못된 세션 ID" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = clean;
    const resolution = RESOLUTIONS.includes(body.resolution as never)
      ? (body.resolution as (typeof RESOLUTIONS)[number])
      : undefined;
    await sessions.endSession(id, me.tenantId, {
      categories: str(body.categories),
      description: str(body.description),
      contactName: str(body.contactName),
      resolution,
      // 직결/릴레이(마이그038) — HQ 가 연결 수립 뒤 알게 된 값을 종료 때 함께 보낸다.
      connDirect:
        typeof body.connDirect === "boolean" ? body.connDirect : undefined,
    });
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
