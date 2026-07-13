// POST /api/sessions/:id/end → 본사 앱(HQ)이 원격 창 닫을 때 호출.
// body 전부 선택적(HQ 종료 모달에서 안 적거나 스킵 가능): categories(A/S 종류 콤마조인),
//   description(내용), contactName(거래처측 응대자), resolution(처리결과). 시간·duration 은 자동.

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import * as sessions from "@/lib/data/sessions";

type Ctx = { params: Promise<{ id: string }> };

const RESOLUTIONS = ["resolved", "pending", "escalated", "in_progress"] as const;

export async function POST(req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(req);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const resolution = RESOLUTIONS.includes(body.resolution as never)
      ? (body.resolution as (typeof RESOLUTIONS)[number])
      : undefined;
    await sessions.endSession(id, me.tenantId, {
      categories: str(body.categories),
      description: str(body.description),
      contactName: str(body.contactName),
      resolution,
    });
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
