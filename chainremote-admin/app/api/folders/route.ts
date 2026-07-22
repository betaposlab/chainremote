// GET  /api/folders            → 내 대리점 폴더 목록 (HQ 폴더 선택 다이얼로그용)
// POST /api/folders { name }   → 폴더 생성 (findOrCreate). viewer 차단.
//
// 폴더 조작은 HQ 앱에서 한다(대리점은 관리 패널을 거의 안 봄). Bearer 인증.

import { requireApiAuth, requireNotViewer, jsonError, ApiAuthError } from "@/lib/api-auth";
import { listFolders, createFolder } from "@/lib/data/folders";

export async function GET(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const folders = await listFolders(me.tenantId);
    return Response.json({ folders });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    requireNotViewer(me); // 읽기 전용 계정은 폴더 생성 불가.
    const body = (await req.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiAuthError(400, "폴더 이름이 필요합니다");
    const folder = await createFolder(me.tenantId, name);
    return Response.json({ folder }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
