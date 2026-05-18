// ChainRemote 관리 패널 인증 미들웨어 — NextAuth v5 (Edge runtime).
//
// 정석 근거:
//   - NextAuth v5 Edge compat: https://authjs.dev/guides/edge-compatibility
//   - DB 접근 providers 는 auth.ts (Node) 에 있어서 여기 import 불가
//   - Edge 에서는 JWT 세션 쿠키만 검사
//
// 흐름:
//   1. matcher 매칭 경로 진입 → auth() 가 JWT 쿠키 검증
//   2. authorized callback 이 false 면 자동으로 signIn 페이지로 리디렉트

import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  if (!req.auth) {
    const url = new URL("/login", req.url);
    if (req.nextUrl.pathname !== "/") {
      url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    }
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};
