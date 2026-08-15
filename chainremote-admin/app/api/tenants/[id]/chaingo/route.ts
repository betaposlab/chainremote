// GET /api/tenants/[id]/chaingo — ChainGo(포터블 HQ) 내려받기. 항상 최신으로 넘긴다.
//
// HQ 와 성격이 같다: 설치본에 대리점 식별자가 없고 실행 후 로그인으로 소속이 갈린다.
// 그래서 한 벌을 누구에게 줘도 되고 오버레이가 필요 없다(Agent 와 결정적으로 다른 점).
//
// ★버전은 latest.json 의 hq 채널을 그대로 쓴다 — ChainGo 는 HQ 와 같은 릴리즈에서
// 같은 버전으로 빌드·발행되기 때문(release-full.sh hq → release-chaingo.sh,
// publish-landing.sh 가 ChainGo_v{HQ버전}.exe 로 올린다). 링크에 버전을 박으면
// 릴리즈마다 사람이 고쳐야 하고 빠뜨리면 그 채널만 옛 버전으로 굳는다.
//
// 호스팅이 NAS 가 아니라 랜딩(Cafe24)인 이유: ChainGo 는 자동업뎃 경로가 없는 무설치
// exe 라 랜딩·자료실로만 배포된다. NAS `/chainremote/` 에는 올라가지 않는다(404).

import { getLiveUser } from "@/lib/auth-guard";
import { getTenant } from "@/lib/data/tenants";
import { fetchHqLatestServer } from "@/lib/hq-latest";

export const dynamic = "force-dynamic";

const LANDING_DOWNLOADS = "https://betaposlab.com/chainremote/downloads";

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  // 브라우저 세션 게이트 — HQ 와 같은 기준(super_admin 또는 그 회사 소속 누구나).
  // ChainGo 는 직원이 쓰는 도구라 owner 로 좁히지 않는다.
  // 세션 쿠키의 존재가 아니라 계정 생존을 본다 — 퇴사자가 설치파일을 계속 받아가면
  //   차단이 반쪽이다(에이전트 exe 에는 대리점 enroll-key 가 박힌다).
  const session = { user: await getLiveUser() };
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
      `최신 버전 정보를 못 읽었습니다 — ${r.errors.join(" / ")}`,
    );
  }
  // 25MB 를 패널로 통과시키지 않고 배포 URL 로 넘긴다(브라우저가 직접 받음).
  return Response.redirect(
    `${LANDING_DOWNLOADS}/ChainGo_v${r.meta.version}.exe`,
    302,
  );
}
