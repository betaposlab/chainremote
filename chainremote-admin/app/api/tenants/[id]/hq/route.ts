// GET /api/tenants/[id]/hq — 본사 앱(HQ) 설치파일 받기. 항상 최신으로 넘긴다.
//
// Agent(/api/tenants/[id]/agent)와 달리 오버레이가 없다 — HQ 설치본에는 대리점
// 식별자가 안 박히고, 받은 사람이 자기 계정으로 로그인하면 그 대리점이 된다.
// 그래서 한 벌을 그대로 내려주면 되고, 링크에 버전도 박지 않는다(박으면 굳는다).
//
// 대리점 온보딩이 이걸로 끝난다: 계정 발급 → 패널 로그인 → 에이전트·HQ 둘 다 여기서.
// 종전엔 HQ 만 받을 곳이 없어 카톡·메일로 손수 보내야 했다.

import { auth } from "@/auth";
import { getTenant } from "@/lib/data/tenants";
import { fetchHqLatestServer } from "@/lib/hq-latest";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(_req: Request, ctx: Ctx) {
  // 브라우저 세션 게이트. super_admin(Chang) 또는 그 회사 소속이면 누구나 —
  // HQ 는 직원이 쓰는 앱이라 owner 로 좁히지 않는다(에이전트와 다른 점).
  const session = await auth();
  const me = session?.user;
  if (!me) return jsonError(403, "로그인이 필요합니다");
  const { id } = await ctx.params;
  const isSuper = me.role === "super_admin";
  if (!isSuper && me.tenantId !== id) {
    return jsonError(403, "이 회사의 설치파일을 받을 권한이 없습니다");
  }

  const t = await getTenant(id);
  if (!t) return jsonError(404, "회사를 찾을 수 없습니다");

  const r = await fetchHqLatestServer();
  if (!r.meta) {
    return jsonError(
      502,
      `최신 HQ 정보를 못 읽었습니다 — ${r.errors.join(" / ")}`,
    );
  }
  // 25MB 를 패널로 통과시키지 않고 배포 URL 로 넘긴다(NAS 공개 경로, 브라우저가 직접 받음).
  return Response.redirect(r.meta.url, 302);
}
