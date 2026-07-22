// PATCH  /api/folders/:id { name }  → 폴더 이름 변경 (tenant 내 이름 유일, 중복이면 409).
// DELETE /api/folders/:id           → 폴더 삭제 (소속 거래처는 folder_id=NULL, 스키마 SET NULL).
//   자기 대리점 폴더만. viewer 차단. Bearer 인증.

import {
  requireApiAuth,
  requireNotViewer,
  isUuid,
  jsonError,
  ApiAuthError,
} from "@/lib/api-auth";
import { deleteFolder, renameFolder } from "@/lib/data/folders";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const me = await requireApiAuth(req);
    requireNotViewer(me);
    const { id } = await ctx.params;
    if (!isUuid(id))
      return Response.json({ error: "잘못된 폴더 ID" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiAuthError(400, "폴더 이름이 필요합니다");
    const r = await renameFolder(id, name, me.tenantId);
    if (r === "notfound")
      return Response.json({ error: "폴더 없음" }, { status: 404 });
    if (r === "dup")
      return Response.json(
        { error: "이미 있는 폴더 이름입니다" },
        { status: 409 },
      );
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

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
