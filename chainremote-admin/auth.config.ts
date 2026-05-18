// NextAuth v5 — Edge 호환 config (middleware 에서 사용).
//
// 정석 근거 (Auth.js v5 docs):
//   - middleware 는 Edge runtime 에서 동작 → Node crypto/pg 등 import 불가
//   - DB 접근하는 providers (Credentials with DB lookup) 는 auth.ts (Node) 에만
//   - Edge 에선 JWT 콜백/세션 체크만 (authorized callback)
// 참고: https://authjs.dev/guides/edge-compatibility

import type { NextAuthConfig } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      displayName: string;
      role: "owner" | "admin" | "operator" | "viewer";
      tenantId: string;
    } & import("next-auth").DefaultSession["user"];
  }

  interface User {
    id?: string;
    email?: string | null;
    displayName: string;
    role: "owner" | "admin" | "operator" | "viewer";
    tenantId: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid: string;
    email: string;
    displayName: string;
    role: "owner" | "admin" | "operator" | "viewer";
    tenantId: string;
  }
}

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login" },
  // 실제 Credentials provider 는 auth.ts 에서 추가 (DB 접근 때문에 Node 전용)
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id!;
        token.email = user.email!;
        token.displayName = user.displayName;
        token.role = user.role;
        token.tenantId = user.tenantId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.uid;
      session.user.email = token.email;
      session.user.displayName = token.displayName;
      session.user.role = token.role;
      session.user.tenantId = token.tenantId;
      return session;
    },
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
  trustHost: true,
};
