// NextAuth v5 — Node runtime (server actions, API routes, RSC).
// Credentials provider 가 DB 와 bcrypt 를 쓰므로 Edge 에서 import 불가.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authConfig } from "./auth.config";
import { db } from "./lib/db";
import { users, tenants } from "./lib/schema";
import { and, eq, sql } from "drizzle-orm";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "ChainRemote",
      credentials: {
        username: { label: "아이디", type: "text" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(credentials) {
        const username = (credentials?.username ?? "").toString().trim();
        const password = (credentials?.password ?? "").toString();
        if (!username || !password) return null;

        // C1: email 전역 유니크(마이그레이션 012)라 단독 조회 안전. H1: 테넌트 상태 동시 조회.
        const rows = await db
          .select({
            id: users.id,
            email: users.email,
            passwordHash: users.passwordHash,
            displayName: users.displayName,
            role: users.role,
            tenantId: users.tenantId,
            tenantActive: tenants.isActive,
            subscriptionStatus: tenants.subscriptionStatus,
          })
          .from(users)
          .innerJoin(tenants, eq(users.tenantId, tenants.id))
          // 아이디는 대소문자를 가리지 않는다(A2-06) — 유니크 인덱스가 lower(email) 이라
          //   단일 행이 보장된다. 패널 로그인도 HQ(/api/auth/token)와 같은 규칙이어야 한다.
          .where(
            and(
              sql`lower(${users.email}) = ${username.toLowerCase()}`,
              eq(users.isActive, true),
            ),
          )
          .limit(1);
        if (rows.length === 0) return null;

        const u = rows[0];
        const ok = bcrypt.compareSync(password, u.passwordHash);
        if (!ok) return null;
        // H1: 정지/해지 테넌트 차단 (super_admin 예외 — 자기잠금 방지).
        if (
          u.role !== "super_admin" &&
          (!u.tenantActive || u.subscriptionStatus !== "active")
        ) {
          return null;
        }

        return {
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          role: u.role,
          tenantId: u.tenantId,
        };
      },
    }),
  ],
});
