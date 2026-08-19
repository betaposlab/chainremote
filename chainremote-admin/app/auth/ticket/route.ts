// GET /auth/ticket?t=... → 본사 앱이 연 주소. 티켓의 주인으로 세션을 만들고 대시보드로 보낸다.
//
// ★티켓은 여기서 소비되며 사라진다. 주소는 방문기록에 남지만 그때는 이미 쓸모없는 값이다.
//   실패(만료·재사용·위조)는 조용히 로그인 화면으로 보낸다 — 무엇이 틀렸는지 알려 주면
//   유효한 티켓을 찾는 데 쓰일 수 있고, 사용자가 할 수 있는 일도 '다시 누르기' 하나뿐이다.
//
// ★이미 **다른 계정**이 로그인돼 있으면 곧바로 갈아타지 않고 확인부터 받는다(2026-08-20).
//   브라우저 쿠키는 도메인당 하나라 앞 계정 세션이 조용히 교체되는데, 대리점에서는 관리자와
//   직원이 보는 화면이 다르고(계정 관리 메뉴) 무엇보다 **감사로그가 바뀐 계정으로 남는다** —
//   A 가 앉은 자리에서 지운 거래처가 기록에는 B 가 지운 것으로 남는 식이다.
//   같은 계정이면 아무것도 묻지 않는다. 자기 패널·자기 HQ 인 대부분의 경우엔 변화가 없다.

import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { peekPanelTicket } from "@/lib/panel-ticket";

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (t) {
    const target = await peekPanelTicket(t);
    if (target) {
      const current = (await auth())?.user?.id;
      if (current && current !== target) {
        // 확인 화면으로. 티켓은 아직 살아 있다 — 소비는 [전환] 을 눌렀을 때 한 번만.
        redirect(`/auth/ticket/confirm?t=${encodeURIComponent(t)}`);
      }
      try {
        // signIn 이 세션 쿠키를 심고 리다이렉트 응답을 돌려준다. 티켓 검증은 provider 안에서.
        return await signIn("panel-ticket", { ticket: t, redirectTo: "/" });
      } catch (e) {
        // NextAuth 는 리다이렉트를 예외로 던진다 — 그건 그대로 흘려보내야 한다.
        if (e && typeof e === "object" && "digest" in e) throw e;
      }
    }
  }
  // ★`new URL("/login", req.url)` 로 만들면 안 된다 — Caddy 뒤의 Route Handler 에서
  //   req.url 은 컨테이너 내부 주소라 브라우저가 못 가는 https://0.0.0.0:3001/login 이
  //   나온다(실측). 나머지 화면들처럼 상대경로 redirect 를 쓴다.
  //   ★redirect 는 try 밖에서 부른다 — 리다이렉트를 예외로 던지는 함수라, try 안에서
  //   부르면 바로 위 catch 가 삼킨다(Next 문서가 명시하는 주의점).
  redirect("/login");
}
