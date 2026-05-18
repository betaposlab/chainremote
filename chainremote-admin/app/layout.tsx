import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { auth, signOut } from "@/auth";

export const metadata: Metadata = {
  title: "ChainRemote 관리 패널",
  description: "ChainRemote 거래처 및 원격지원 관리",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const user = session?.user;

  // 미인증 (예: /login 페이지) — 사이드바 없이 children 만
  if (!user) {
    return (
      <html lang="ko" className="h-full antialiased">
        <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
      </html>
    );
  }

  // 인증된 사용자 — 사이드바 + 헤더 박힌 본 레이아웃
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex bg-slate-50 text-slate-900">
        <aside className="w-60 shrink-0 border-r border-slate-200 bg-white flex flex-col">
          <div className="px-6 py-5 border-b border-slate-200">
            <Link href="/" className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#00A0E5] text-white text-sm font-bold">
                CR
              </span>
              <span className="font-semibold tracking-tight">ChainRemote</span>
            </Link>
          </div>
          <nav className="p-3 space-y-1 text-sm flex-1">
            <NavItem href="/">대시보드</NavItem>
            <NavItem href="/customers">거래처</NavItem>
            <NavItem href="/sessions">지원기록</NavItem>
            {user.role === "owner" && <NavItem href="/users">사용자</NavItem>}
            <NavItem href="/settings">설정</NavItem>
          </nav>
          {/* 사이드바 하단 — 현재 사용자 정보 + 로그아웃 */}
          <div className="border-t border-slate-200 p-3 pb-6 text-sm">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 font-medium text-slate-600">
                {user.displayName.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-700">
                  {user.displayName}
                </div>
                <div className="truncate text-xs text-slate-500">
                  @{user.email} · {roleLabel(user.role)}
                </div>
              </div>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-4 w-4"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"
                  />
                </svg>
                로그아웃
              </button>
            </form>
          </div>
        </aside>
        <main className="flex-1 min-w-0">{children}</main>
      </body>
    </html>
  );
}

function NavItem({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block px-3 py-2 rounded-md hover:bg-slate-100 transition-colors"
    >
      {children}
    </Link>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "오너";
    case "admin":
      return "관리자";
    case "operator":
      return "직원";
    case "viewer":
      return "뷰어";
    default:
      return role;
  }
}
