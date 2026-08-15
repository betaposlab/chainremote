// ChainRemote 로그인 페이지
//
// 이 페이지는 middleware 가 / login / api/auth 는 제외하므로 인증 없이 접근 가능.
// 폼 POST → server action → auth.signIn("credentials", ...) → 성공 시 next 또는 / 로 리디렉트.

import { redirect } from "next/navigation";
import { signIn, auth } from "@/auth";
import { AuthError } from "next-auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // 이미 로그인됐으면 / 로.
  //
  // ★단, 세션이 가리키는 계정이 아직 살아 있을 때만이다. JWT 는 자체 서명이라 계정이나
  //   회사가 사라져도 유효해 보이는데, 그 상태로 / 에 보내면 홈이 tenant 를 못 찾아 다시
  //   /login 으로 보낸다 → **무한 리다이렉트**로 로그인도 로그아웃도 못 하는 상태가 된다
  //   (쿠키를 손으로 지우는 것 말곤 방법이 없다). 회사 삭제·계정 삭제·DB 복원 뒤에 실제로
  //   생길 수 있는 경로다. 계정이 없으면 그냥 로그인 폼을 보여줘 스스로 빠져나오게 한다.
  const session = await auth();
  if (session?.user?.id) {
    const [alive] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    if (alive) redirect("/");
  }

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
      </div>

      {/* 운영사 표기 — 대리점 직원이 보는 첫 화면이라 누가 운영하는 서비스인지 밝힌다. */}
      <footer className="relative z-10 mt-8 text-center text-xs leading-relaxed text-[#ccd2e3]">
        <p>
          © 2026 베타포스랩 (BetaPosLab) · ChainRemote 플랫폼 운영
        </p>
        <p className="mt-0.5">
          <a
            href="https://betaposlab.com/chainremote"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white hover:underline"
          >
            서비스 소개
          </a>
          <span className="mx-1.5">·</span>
          RustDesk 기반 오픈소스 (AGPL-3.0)
        </p>
      </footer>
    </div>
  );
}
