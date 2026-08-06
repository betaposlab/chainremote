// ChainRemote 관리 패널 인증 Proxy — NextAuth v5 (Edge runtime).
//
// Next 16 부터 middleware.ts 는 proxy.ts 로 이름 변경 (기능 동일).
//   https://nextjs.org/docs/app/api-reference/file-conventions/proxy
//
// 정석 근거:
//   - NextAuth v5 Edge compat: https://authjs.dev/guides/edge-compatibility
//   - DB 접근 providers 는 auth.ts (Node) 에 있어서 여기 import 불가
//   - Edge 에서는 JWT 세션 쿠키만 검사
//
// 흐름:
//   1. matcher 매칭 경로 진입 → auth() 가 JWT 쿠키 검증
//   2. /api/* 는 이중 안전망으로 함수 내부에서도 즉시 통과 (Bearer 토큰은 각 API
//      라우트의 requireApiAuth 가 검증). Next 16 matcher 동작 변화 대비.

import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  // 이중 안전망: matcher 가 /api 를 제외했더라도 명시적으로 한 번 더 통과.
  // 본사 데스크톱 앱이 Bearer 로 호출 → 쿠키 없음 → 여기서 막히면 안 됨.
  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }
  if (!req.auth) {
    const url = new URL("/login", req.url);
    if (req.nextUrl.pathname !== "/") {
      url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    }
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

// 매처: 브라우저 패널 페이지(RSC)만 NextAuth 쿠키 보호.
// /api/* 는 전부 제외 — 데스크톱 앱이 Bearer 토큰으로 호출 (lib/api-auth.ts).
//   - /api/auth/*  : NextAuth 핸들러 + 우리 /api/auth/token
//   - /api/customers, /api/me/*, /api/sessions : requireApiAuth 로 자체 보호
// chainremote-logo.png 예외: 로그인 화면이 이 로고를 쓰는데, matcher 에 걸려 이미지
// 요청조차 /login 으로 307 되돌려져 **로그인 화면의 로고가 늘 깨져 있었다**(favicon 은
// 예외라 멀쩡했다). 랜딩에도 공개돼 있는 브랜드 워드마크라 가릴 이유가 없다.
// 확장자 일반 패턴(\..*) 대신 파일명 하나만 뺀다 — 넓게 열면 점이 든 경로가 딸려 풀린다.
export const config = {
  matcher: [
    "/((?!api|login|_next/static|_next/image|favicon.ico|chainremote-logo\\.png).*)",
  ],
};
