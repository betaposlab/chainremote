"use client";

// 거래처 화면 자동 갱신(2026-07-16 Chang) — 디스크 관제가 생기며 정리 결과·여유공간이
// 수시로 바뀌는데 수동 새로고침을 요구하면 관제가 아니다. 탭이 보일 때만 30초 주기로
// 서버 컴포넌트를 재조회한다(router.refresh — 입력/스크롤 등 클라 상태는 보존).

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs]);
  return null;
}
