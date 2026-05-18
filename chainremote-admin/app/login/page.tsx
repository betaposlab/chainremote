// ChainRemote 로그인 페이지
//
// 이 페이지는 middleware 가 / login / api/auth 는 제외하므로 인증 없이 접근 가능.
// 폼 POST → server action → auth.signIn("credentials", ...) → 성공 시 next 또는 / 로 리디렉트.

import { redirect } from "next/navigation";
import { signIn, auth } from "@/auth";
import { AuthError } from "next-auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // 이미 로그인됐으면 / 로
  const session = await auth();
  if (session?.user) redirect("/");

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
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#00A0E5] text-white text-base font-bold">
            CR
          </div>
          <h1 className="text-lg font-semibold tracking-tight">ChainRemote 관리 패널</h1>
          <p className="mt-1 text-sm text-slate-500">사내 직원 전용</p>
        </div>

        {errorMsg === "invalid" && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            아이디 또는 비밀번호가 일치하지 않습니다.
          </div>
        )}

        <form action={login} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="username">
              아이디
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              autoFocus
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-[#00A0E5] focus:outline-none focus:ring-1 focus:ring-[#00A0E5]"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="password">
              비밀번호
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-[#00A0E5] focus:outline-none focus:ring-1 focus:ring-[#00A0E5]"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-[#00A0E5] px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#0090d0] focus:outline-none focus:ring-2 focus:ring-[#00A0E5]/40"
          >
            로그인
          </button>
        </form>
      </div>
    </div>
  );
}
