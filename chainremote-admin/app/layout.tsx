import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { auth, signOut } from "@/auth";
import { roleLabel, canManageAccounts } from "@/lib/roles";

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
        <body className="min-h-full bg-[#242c40] text-white">{children}</body>
      </html>
    );
  }

  // 인증된 사용자 — 사이드바 + 헤더 박힌 본 레이아웃.
  // 다크 톤은 랜딩(betaposlab.com/chainremote)과 같은 언어(AgentQL 계열) —
  // 매일 쓰는 도구라 오로라·모션은 빼고 4층 표면(Void/Abyss/DeepSea/Cobalt)만 가져왔다.
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex bg-[#242c40] text-white">
        <aside className="w-60 shrink-0 border-r border-[#46557c] bg-[#1c2333] flex flex-col sticky top-0 h-screen">
          <div className="px-5 py-5 border-b border-[#46557c]">
            {/* 로고 클릭 = 소개 랜딩 페이지(새 탭). 홈(대시보드)은 아래 메뉴로 간다. */}
            <a
              href="https://betaposlab.com/chainremote"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center"
              title="ChainRemote 소개 페이지 열기"
            >
              {/* 우리 로고 워드마크(랜딩 헤더와 동일). next/image 대신 정적 <img> — 브랜드 자산. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/chainremote-logo.png"
                alt="ChainRemote"
                className="h-9 w-auto"
              />
            </a>
          </div>
          <nav className="p-3 space-y-1 text-sm flex-1 overflow-y-auto min-h-0">
            <NavItem href="/">대시보드</NavItem>
            <NavItem href="/customers">거래처</NavItem>
            <NavItem href="/sessions">지원기록</NavItem>
            {user.role !== "super_admin" && canManageAccounts(user.role) && (
              <NavItem href="/users">사용자</NavItem>
            )}
            {user.role === "super_admin" && (
              <>
                <NavItem href="/users">사용자</NavItem>
                <div className="mt-4 mb-1 px-3 text-[0.68rem] font-semibold uppercase tracking-wider text-[#a3aac2]">
                  플랫폼 운영
                </div>
                <NavItem href="/admin/tenants">회사 관리</NavItem>
              </>
            )}
          </nav>
          {/* 사이드바 하단 — 현재 사용자 정보 + 로그아웃 */}
          <div className="border-t border-[#46557c] p-3 pb-6 text-sm">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#3c4f82] border border-[#56699c] font-medium text-[#a9c0ff]">
                {user.displayName.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-white">
                  {user.displayName}
                </div>
                <div className="truncate text-xs text-[#b9bfd2]">
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
                className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[#abaebb] hover:bg-white/[0.05] hover:text-white transition-colors"
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
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1">{children}</div>
          {/* 운영사 푸터 — 모든 인증 화면 하단 공통. 대리점(tenant) 사용자에게도
              보이는 화면이라, 표기는 개별 회사가 아니라 플랫폼 운영사(베타포스랩)다. */}
          <footer className="border-t border-[#384462] px-8 py-4 text-xs text-[#a3aac2]">
            <span>© 2026 베타포스랩 (BetaPosLab) · ChainRemote 플랫폼 운영</span>
            <span className="mx-2">·</span>
            <a
              href="https://betaposlab.com/chainremote"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white hover:underline"
            >
              서비스 소개
            </a>
            <span className="mx-2">·</span>
            <span>RustDesk 기반 오픈소스 (AGPL-3.0)</span>
          </footer>
        </main>
      </body>
    </html>
  );
}

function NavItem({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="block px-3 py-2 rounded-md text-[#abaebb] hover:bg-white/[0.05] hover:text-white transition-colors"
    >
      {children}
    </Link>
  );
}

