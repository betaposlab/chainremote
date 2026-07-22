// DELETE /api/folders/:id  → 폴더 삭제 (소속 거래처는 folder_id=NULL 로 남음, 스키마 SET NULL).
//   자기 대리점 폴더만. viewer 차단. Bearer 인증.

import { requireApiAuth, requireNotViewer, isUuid, jsonError } from "@/lib/api-auth";
import { deleteFolder } from "@/lib/data/folders";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(req);
    requireNotViewer(me);
    const { id } = await ctx.params;
    if (!isUuid(id))
      return Response.json({ error: "잘못된 폴더 ID" }, { status: 404 });
    const ok = await deleteFolder(id, me.tenantId);
    if (!ok) return Response.json({ error: "폴더 없음" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
