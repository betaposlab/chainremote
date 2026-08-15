import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { signApiToken } from "@/lib/api-auth";
import { requireApiAuth, ApiAuthError } from "@/lib/api-auth";
import { claimSeat, getActiveSession, revokeSeat } from "@/lib/data/active-sessions";
import { activeLoginSessions, tenants, users } from "@/lib/schema";

// 퇴사자 즉시 차단(2026-08-15 Chang) — 계정을 지우거나 비활성으로 바꾸면 그 즉시 막힌다.
//   종전: 패널 세션 쿠키는 7일, HQ Bearer 토큰은 24h 동안 계속 살아 있었다.
//   여기서는 HQ(API) 표면과 좌석 회수를 검증한다. 패널(세션) 표면은 lib/auth-guard.ts 가
//   같은 판정을 쓰고 auth() 목킹이 필요해 브라우저 검증으로 대신한다.

async function seed(opts?: { active?: boolean }) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug: "revoke", displayName: "revoke" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({
      tenantId: t.id,
      email: "leaver",
      displayName: "퇴사자",
      passwordHash: "x",
      role: "operator",
      isActive: opts?.active ?? true,
    })
    .returning({ id: users.id });
  return { tenantId: t.id, userId: u.id };
}

async function tokenFor(userId: string, tenantId: string) {
  const { token } = await signApiToken({
    uid: userId,
    email: "leaver",
    displayName: "퇴사자",
    role: "operator",
    tenantId,
  });
  return token;
}

function req(token: string) {
  return new Request("https://api.626.kr/api/customers", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("퇴사자 즉시 차단 — HQ(API) 표면", () => {
  it("살아 있는 계정은 통과한다", async () => {
    const s = await seed();
    const me = await requireApiAuth(req(await tokenFor(s.userId, s.tenantId)));
    expect(me.uid).toBe(s.userId);
  });

  it("계정을 지우면 발급된 토큰이 그 즉시 죽는다(24h 안 기다림)", async () => {
    const s = await seed();
    const token = await tokenFor(s.userId, s.tenantId);
    await testDb().delete(users).where(eq(users.id, s.userId));
    await expect(requireApiAuth(req(token))).rejects.toMatchObject({
      status: 401,
      revoked: true,
    });
  });

  it("★비활성으로 내려도 즉시 죽는다 — 좌석이 남아 통과하던 구멍", async () => {
    const s = await seed();
    const token = await tokenFor(s.userId, s.tenantId);
    await testDb().update(users).set({ isActive: false }).where(eq(users.id, s.userId));
    const err = await requireApiAuth(req(token)).catch((e) => e);
    expect(err).toBeInstanceOf(ApiAuthError);
    expect(err.status).toBe(401);
    // revoked=true 라야 HQ 가 재로그인 시도 없이 바로 로그아웃한다.
    expect(err.revoked).toBe(true);
  });
});

describe("좌석 강제 회수", () => {
  it("revokeSeat 은 jti 를 따지지 않고 그 계정 좌석을 비운다", async () => {
    const s = await seed();
    await claimSeat({
      userId: s.userId,
      jti: "00000000-0000-4000-8000-000000000001",
      deviceId: "dev-1",
      deviceLabel: "desktop-1a8l3cv",
      ip: "1.2.3.4",
    });
    expect(await getActiveSession(s.userId)).toBeTruthy();
    await revokeSeat(s.userId);
    expect(await getActiveSession(s.userId)).toBeFalsy();
  });

  it("계정 삭제는 좌석까지 함께 지운다(FK cascade)", async () => {
    const s = await seed();
    await claimSeat({
      userId: s.userId,
      jti: "00000000-0000-4000-8000-000000000002",
      deviceId: "dev-2",
      deviceLabel: "home-pc",
      ip: "5.6.7.8",
    });
    await testDb().delete(users).where(eq(users.id, s.userId));
    const rows = await testDb()
      .select()
      .from(activeLoginSessions)
      .where(eq(activeLoginSessions.userId, s.userId));
    expect(rows).toHaveLength(0);
  });
});
