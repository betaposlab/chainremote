// ChainRemote 로그인 페이지
//
// 이 페이지는 middleware 가 / login / api/auth 는 제외하므로 인증 없이 접근 가능.
// 폼 POST → server action → auth.signIn("credentials", ...) → 성공 시 next 또는 / 로 리디렉트.

import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getLiveUser } from "@/lib/auth-guard";
import { AuthError } from "next-auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // 이미 로그인됐으면 / 로.
  //
  // ★단, 세션이 가리키는 계정이 아직 살아 있을 때만이다. JWT 는 자체 서명이라 계정이나
  //   회사가 사라져도 유효해 보이는데, 그 상태로 / 에 보내면 홈이 다시 /login 으로 보내
  //   **무한 리다이렉트**가 된다(로그인도 로그아웃도 못 하고 쿠키를 손으로 지워야 한다).
  //   삭제·비활성 계정이면 그냥 로그인 폼을 보여줘 스스로 빠져나오게 한다.
  if (await getLiveUser()) redirect("/");

  const params = await searchParams;
  const next = params.next ?? "/";
  const errorMsg = params.error;

  async function login(formData: FormData) {
    "use server";
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    try {
      await signIn("credentials", {
        username,
        password,
        redirectTo: next,
      });
    } catch (e) {
      // NextAuth 가 redirect 던지면 그대로 throw — 진짜 에러만 잡음
      if (e instanceof AuthError) {
        redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
      }
      throw e;
    }
  }

  return (
    <div className="aurora-bg flex min-h-screen w-full flex-col items-center justify-center bg-[#2b364f] px-4">
      <div className="relative z-10 w-full max-w-sm space-y-6 rounded-xl border border-[#566999] bg-[#3d4e7a] p-8 shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
        <div className="text-center">
          {/* 사이드바·랜딩과 같은 워드마크 — 종전의 파란 "CR" 박스는 임시 심볼이었다.
              "사내 직원 전용" 부제는 뺐다: 대리점 직원도 로그인하는 멀티테넌트 화면이라
              사실과도 안 맞았다 (2026-08-05 Chang). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/chainremote-logo.png"
            alt="ChainRemote"
            className="mx-auto mb-4 h-12 w-auto"
          />
          <h1 className="text-lg font-semibold tracking-tight text-white">ChainRemote 관리 패널</h1>
        </div>

        {errorMsg === "invalid" && (
          <div className="banner banner-danger">
            아이디 또는 비밀번호가 일치하지 않습니다.
          </div>
        )}

        <form action={login} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[#eef1f7]" htmlFor="username">
              아이디
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              autoFocus
              className="input"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[#eef1f7]" htmlFor="password">
              비밀번호
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="input"
            />
          </div>
          <button type="submit" className="btn btn-primary w-full">
            로그인
          </button>
        </form>

        {/* 잘못 들어온 사람의 출구.
            626.kr 을 치면 여기가 뜨는데(맨 주소는 패널이다), 소개 페이지는 /main/ 에 있다.
            팜플렛을 보고 주소 뒤를 빠뜨린 사람이 로그인 화면에서 막히면 그대로 돌아간다 —
            직원은 매일 보는 화면이라 방해되지 않게 폼 아래 한 줄로만 둔다.
            ★같은 호스트 안이라 상대경로다. 새 탭으로 열지 않는다(여기가 목적지가 아니다). */}
        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="mb-2.5 text-center text-sm">
            <span className="cr-shimmer">체인리모트가 궁금해서 오셨나요?</span>
          </p>
          {/* ★로그인 버튼과 경쟁하지 않으면서 눈에는 띄어야 한다. 채운 버튼을 하나 더 두면
              직원이 매일 "둘 중 뭘 눌러야 하지"를 겪는다 — 그래서 외곽선으로 위계를 낮춘다.
              대신 폭·높이는 로그인 버튼과 같게 맞춰 존재감을 확보한다.
              ★테두리를 액센트(#4C7DFF) 그대로 쓰면 카드 배경(#3D4E7A)과 밝기가 비슷해
              묻힌다(실물 확인). 한 단계 밝은 파랑으로 올리고 글자는 흰색으로 둔다 —
              어두운 남색 위에서는 채도보다 밝기 차이가 눈에 걸린다. */}
          {/* ★테두리는 style 로 준다. globals.css 의 `.btn` 이 `border: 1px solid transparent`
              를 레이어 없이 선언해서, Tailwind 의 border-* 유틸리티(레이어드)가 진다 —
              class 로 주면 조용히 무시되고 계산값이 1px/transparent 로 남는다(실측 확인).
              배경·글자색은 `.btn` 이 안 건드려서 유틸리티가 그대로 먹는다. */}
          <a
            href="/main/"
            style={{ borderWidth: "2px", borderColor: "#8FB3FF" }}
            className="btn w-full bg-[#4C7DFF]/20 text-[0.9rem] font-semibold text-white transition-colors hover:bg-[#4C7DFF]/35"
          >
            제품 소개 보기
            <span aria-hidden="true" className="ml-1.5">→</span>
          </a>
        </div>
      </div>

      {/* 운영사 표기 — 대리점 직원이 보는 첫 화면이라 누가 운영하는 서비스인지 밝힌다. */}
      <footer className="relative z-10 mt-8 text-center text-xs leading-relaxed text-[#ccd2e3]">
        <p>
          © 2026 베타포스랩 (BetaPosLab) · ChainRemote 플랫폼 운영
        </p>
        <p className="mt-0.5">
          <a href="/main/" className="hover:text-white hover:underline">
            서비스 소개
          </a>
          <span className="mx-1.5">·</span>
          RustDesk 기반 오픈소스 (AGPL-3.0)
        </p>
      </footer>
    </div>
  );
}
