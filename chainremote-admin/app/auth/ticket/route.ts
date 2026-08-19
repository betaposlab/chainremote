// GET /auth/ticket?t=... → 본사 앱이 연 주소. 티켓을 확인해 그 계정으로 세션을 만들고 대시보드로 보낸다.
//
// ★티켓은 여기서 소비되며 사라진다. 주소는 방문기록에 남지만 그때는 이미 쓸모없는 값이다.
//   실패(만료·재사용·위조)는 조용히 로그인 화면으로 보낸다 — 무엇이 틀렸는지 알려 주면
//   유효한 티켓을 찾는 데 쓰일 수 있고, 사용자가 할 수 있는 일도 '다시 누르기' 하나뿐이다.

import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (t) {
    try {
      // signIn 이 세션 쿠키를 심고 리다이렉트 응답을 돌려준다. 티켓 검증은 provider 안에서.
      return await signIn("panel-ticket", { ticket: t, redirectTo: "/" });
    } catch (e) {
      // NextAuth 는 리다이렉트를 예외로 던진다 — 그건 그대로 흘려보내야 한다.
      if (e && typeof e === "object" && "digest" in e) throw e;
    }
  }
  // 실패(빈 값·만료·재사용·위조)는 조용히 로그인 화면으로.
  //   ★`new URL("/login", req.url)` 로 만들면 안 된다 — Caddy 뒤의 Route Handler 에서
  //   req.url 은 컨테이너 내부 주소라 브라우저가 못 가는 https://0.0.0.0:3001/login 이
  //   나온다(실측). 나머지 화면들처럼 상대경로 redirect 를 쓴다.
  //   ★redirect 는 try 밖에서 부른다 — 리다이렉트를 예외로 던지는 함수라, try 안에서
  //   부르면 바로 위 catch 가 삼킨다(Next 문서가 명시하는 주의점).
  redirect("/login");
}
