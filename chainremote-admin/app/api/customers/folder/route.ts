// POST /api/customers/folder { remoteId, folderId }
//   HQ 우클릭 "폴더로 이동" — remoteId 로 거래처를 찾아 폴더 배정. folderId 가 빈값/없으면 해제.
//   viewer 차단. Bearer 인증. 남의 폴더/거래처는 assignFolder 가 tenant 로 막는다.

import { requireApiAuth, requireNotViewer, jsonError, ApiAuthError } from "@/lib/api-auth";
import { assignFolder } from "@/lib/data/folders";
import { db } from "@/lib/db";
import { customers } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    requireNotViewer(me);
    const body = (await req.json().catch(() => ({}))) as {
      remoteId?: unknown;
      folderId?: unknown;
    };
    const remoteId =
      typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    if (!remoteId) throw new ApiAuthError(400, "remoteId 필수");
    // 문자열이면 배정, 빈값/누락이면 폴더 해제(null).
    const folderId =
      typeof body.folderId === "string" && body.folderId.trim()
        ? body.folderId.trim()
        : null;
    // remoteId → 내 대리점 거래처(uuid). 남의 tenant remoteId 는 안 잡힘.
    const [c] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(eq(customers.remoteId, remoteId), eq(customers.tenantId, me.tenantId)),
      )
      .limit(1);
    if (!c) return Response.json({ error: "거래처 없음" }, { status: 404 });
    const ok = await assignFolder(c.id, folderId, me.tenantId);
    if (!ok)
      return Response.json(
        { error: "폴더 배정 실패(폴더 없음 또는 권한)" },
        { status: 400 },
      );
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
