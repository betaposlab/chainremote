// GET /auth/ticket?t=... → 본사 앱이 연 주소. 티켓을 확인해 그 계정으로 세션을 만들고 대시보드로 보낸다.
//
// ★티켓은 여기서 소비되며 사라진다. 주소는 방문기록에 남지만 그때는 이미 쓸모없는 값이다.
//   실패(만료·재사용·위조)는 조용히 로그인 화면으로 보낸다 — 무엇이 틀렸는지 알려 주면
//   유효한 티켓을 찾는 데 쓰일 수 있고, 사용자가 할 수 있는 일도 '다시 누르기' 하나뿐이다.

import { signIn } from "@/auth";

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!t) return Response.redirect(new URL("/login", req.url), 302);
  try {
    // signIn 이 세션 쿠키를 심고 리다이렉트 응답을 돌려준다. 티켓 검증은 provider 안에서.
    return await signIn("panel-ticket", { ticket: t, redirectTo: "/" });
  } catch (e) {
    // NextAuth 는 리다이렉트를 예외로 던진다 — 그건 그대로 흘려보내야 한다.
    if (e && typeof e === "object" && "digest" in e) throw e;
    return Response.redirect(new URL("/login", req.url), 302);
  }
}
