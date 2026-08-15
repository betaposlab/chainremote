// POST /api/me/password { currentPassword, newPassword } → 본인 비밀번호 변경.
//
// 인증: Bearer JWT (api-auth). me.uid 의 user row 만 변경.
// 검증: 현재 비번 bcrypt.compareSync 통과해야 새 hash 저장.

import bcrypt from "bcryptjs";
import { revokeSeat } from "@/lib/data/active-sessions";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { requireApiAuth, jsonError, ApiAuthError } from "@/lib/api-auth";

const BCRYPT_COST = 10;

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const body = (await req.json().catch(() => ({}))) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";

    if (!currentPassword) throw new ApiAuthError(400, "현재 비밀번호 필요");
    if (!newPassword) throw new ApiAuthError(400, "새 비밀번호 필요");
    if (newPassword.length < 4)
      throw new ApiAuthError(400, "새 비밀번호 4자 이상");

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, me.uid))
      .limit(1);
    const u = rows[0];
    if (!u) throw new ApiAuthError(404, "사용자 없음");

    if (!bcrypt.compareSync(currentPassword, u.passwordHash)) {
      throw new ApiAuthError(403, "현재 비밀번호 불일치");
    }

    const newHash = bcrypt.hashSync(newPassword, BCRYPT_COST);
    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, me.uid));
  // 비번을 바꾸면 기존 세션도 끊는다(A2-04, 2026-08-16). 종전엔 해시만 갈아서, 계정이
  //   털려 비번을 바꿔도 침입자 HQ 는 heartbeat 200 + 롤링 재발급으로 앱을 안 끄는 한
  //   영구히 살아 있었고 좌석까지 물고 있어 정당한 사용자가 409 를 맞았다.
  //   좌석을 비우면 그 HQ 는 ~5초 뒤 REVOKED 로 스스로 로그아웃한다.
    await revokeSeat(me.uid);

    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
