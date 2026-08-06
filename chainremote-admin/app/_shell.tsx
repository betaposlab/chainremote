"use client";

// 인증 화면의 바깥 골격 — 데스크톱은 종전 그대로(사이드바가 flex 흐름 안의 sticky 기둥),
// 모바일은 사이드바를 화면 밖으로 밀어두고 상단바의 햄버거로 여는 서랍이 된다.
//
// 왜 클라이언트 컴포넌트인가: layout.tsx 는 auth() 를 쓰는 서버 컴포넌트라 상태를 못 든다.
// 사이드바 알맹이(로그인 정보·로그아웃 서버액션 포함)는 서버에서 렌더해 prop 으로 받는다 —
// 그래야 세션 조회가 서버에 남고 이 파일은 여닫는 일만 한다.

import { useEffect, useState } from "react";

export function Shell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 서랍이 열린 동안 뒤 본문이 따라 스크롤되지 않게 잠근다.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex min-h-full">
      {/* 모바일 상단바 — md 이상에선 사라지고 데스크톱은 종전과 완전히 같아진다 */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-[#566999] bg-[#2b364f] px-4 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="메뉴 열기"
          aria-expanded={open}
          className="-ml-1 rounded-md p-2 text-[#cbd1e0] hover:bg-white/[0.06] hover:text-white transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.7}
            stroke="currentColor"
            className="h-5 w-5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
          </svg>
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/chainremote-logo.png" alt="ChainRemote" className="h-6 w-auto" />
      </header>

      {/* 서랍 뒤 어둠 — 눌러서 닫는다 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* 사이드바. 모바일=화면 밖 fixed 서랍 / md 이상=흐름 안의 sticky 기둥(종전 동작).
          md:translate-x-0 이 없으면 데스크톱에서도 닫힌 상태의 이동값이 남아 사라진다. */}
      <aside
        // 메뉴를 눌러 이동하면 서랍을 닫는다 — 안 그러면 이동한 화면이 서랍에 가린 채로 남는다.
        // 링크는 서버 컴포넌트가 렌더하므로 각 <Link> 에 핸들러를 못 단다. pathname 을 보는
        // effect 로도 되지만 그건 effect 안 setState(연쇄 렌더)라, 여기서 위임으로 받는다.
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a[href]")) setOpen(false);
        }}
        className={`fixed left-0 top-0 z-50 flex h-screen w-60 shrink-0 flex-col border-r border-[#566999] bg-[#2b364f] transition-transform duration-200 ease-out motion-reduce:transition-none md:sticky md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* 서랍 닫기 — 모바일 전용. 배경 탭이나 Esc 로도 닫히지만 눈에 보이는 출구가 있어야 한다 */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="메뉴 닫기"
          className="absolute right-2 top-2 rounded-md p-2 text-[#cbd1e0] hover:bg-white/[0.06] hover:text-white transition-colors md:hidden"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.7}
            stroke="currentColor"
            className="h-5 w-5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
        {sidebar}
      </aside>

      {/* pt-14 = 모바일 고정 상단바 높이만큼 본문을 내린다 */}
      <main className="flex min-w-0 flex-1 flex-col pt-14 md:pt-0">{children}</main>
    </div>
  );
}
