// GET /api/tenants/[id]/android — 안드로이드 HQ(APK) 받기. 항상 최신으로 넘긴다.
//
// 이동이 잦은 대리점 직원용이다(2026-09-08 Chang). 다른 매장에 있으면서 급히 한 곳을
// 봐야 할 때 폰에 깔아 둔 이 앱으로 붙는다. HQ 와 성격이 같다: 설치본에 대리점 식별자가
// 없고 로그인으로 소속이 갈리므로 한 벌을 누구에게 줘도 되고 오버레이가 없다.
//
// 스토어 밖 APK 라 폰에서 "이 출처 허용"을 한 번 켜야 한다 — 그 안내는 다운로드 카드에 있다.
// 자동 업데이트는 없다(스토어에 올리기 전까지). 새 버전은 이 링크를 다시 받아 덮어 깐다.

import { getLiveUser } from "@/lib/auth-guard";
import { getTenant } from "@/lib/data/tenants";
import { fetchAndroidLatestServer } from "@/lib/android-latest";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(_req: Request, ctx: Ctx) {
  // HQ 라우트와 같은 관문 — 계정이 지금도 살아 있는지를 본다(퇴사자 차단이 반쪽이 되지 않게).
  const me = await getLiveUser();
  if (!me) return jsonError(403, "로그인이 필요합니다");
  const { id } = await ctx.params;
  const isSuper = me.role === "super_admin";
  if (!isSuper && me.tenantId !== id) {
    return jsonError(403, "이 회사의 설치파일을 받을 권한이 없습니다");
  }

  const t = await getTenant(id);
  if (!t) return jsonError(404, "회사를 찾을 수 없습니다");

  const r = await fetchAndroidLatestServer();
  if (!r.meta) {
    return jsonError(502, `최신 안드로이드 앱 정보를 못 읽었습니다 — ${r.errors.join(" / ")}`);
  }
  // 30MB 를 패널로 통과시키지 않고 배포 URL 로 넘긴다(NAS 공개 경로, 폰 브라우저가 직접 받음).
  return Response.redirect(r.meta.url, 302);
}
