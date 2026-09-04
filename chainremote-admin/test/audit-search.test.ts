// 감사 기록 조회 — 화면이 쓰는 쿼리.
//
// 여기서 잠그는 건 하나가 압도적으로 중요하다: **다른 회사 기록이 안 보인다.**
// 이 화면은 로그인 시각과 IP 를 보여 주는 자리라, 격리가 새면 대리점끼리 서로의
// 접속 시간을 들여다보게 된다. 나머지(기간·종류·검색)는 그다음이다.

import { describe, it, expect } from "vitest";
import { testDb } from "./helpers/db";
import { tenants, users, auditLogs } from "@/lib/schema";
import { searchAudit } from "@/lib/data/audit-search";

async function seed(slug: string, email: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({
      tenantId: t.id,
      email,
      passwordHash: "x",
      displayName: `${slug} 사장`,
      role: "owner",
    })
    .returning({ id: users.id });
  return { tenantId: t.id, userId: u.id };
}

async function log(
  tenantId: string,
  userId: string | null,
  action: string,
  extra: Partial<{ ipAddress: string; metadata: unknown; createdAt: Date }> = {},
) {
  await testDb()
    .insert(auditLogs)
    .values({ tenantId, userId, action, ...extra });
}

describe("감사 기록 조회", () => {
  it("★다른 회사 기록은 안 보인다", async () => {
    const a = await seed("as-a", "as-a@t");
    const b = await seed("as-b", "as-b@t");
    await log(a.tenantId, a.userId, "auth.login");
    await log(b.tenantId, b.userId, "auth.login");

    const mine = await searchAudit({
      tenantId: a.tenantId,
      period: "all",
      kind: "all",
    });
    expect(mine).toHaveLength(1);
    expect(mine[0].actorEmail).toBe("as-a@t");
  });

  it("tenantId 를 null 로 주면 전 회사가 보인다 (super_admin 전용 경로)", async () => {
    const a = await seed("as-p1", "as-p1@t");
    const b = await seed("as-p2", "as-p2@t");
    await log(a.tenantId, a.userId, "auth.login");
    await log(b.tenantId, b.userId, "customer.delete");

    const all = await searchAudit({
      tenantId: null,
      period: "all",
      kind: "all",
    });
    const emails = all.map((r) => r.actorEmail);
    expect(emails).toContain("as-p1@t");
    expect(emails).toContain("as-p2@t");
  });

  it("종류로 가른다 — 로그인 소음에 변경 한 줄이 묻히면 안 된다", async () => {
    const a = await seed("as-k", "as-k@t");
    await log(a.tenantId, a.userId, "auth.login");
    await log(a.tenantId, a.userId, "auth.login_failed");
    await log(a.tenantId, a.userId, "customer.delete");

    const auth = await searchAudit({
      tenantId: a.tenantId,
      period: "all",
      kind: "auth",
    });
    expect(auth.map((r) => r.action).sort()).toEqual([
      "auth.login",
      "auth.login_failed",
    ]);

    const change = await searchAudit({
      tenantId: a.tenantId,
      period: "all",
      kind: "change",
    });
    expect(change.map((r) => r.action)).toEqual(["customer.delete"]);
  });

  it("기간 밖은 빠진다", async () => {
    const a = await seed("as-t", "as-t@t");
    await log(a.tenantId, a.userId, "auth.login", {
      createdAt: new Date(Date.now() - 60 * 86_400_000),
    });
    const week = await searchAudit({
      tenantId: a.tenantId,
      period: "week",
      kind: "all",
    });
    expect(week).toHaveLength(0);
    const all = await searchAudit({
      tenantId: a.tenantId,
      period: "all",
      kind: "all",
    });
    expect(all).toHaveLength(1);
  });

  it("IP 로 찾는다", async () => {
    const a = await seed("as-ip", "as-ip@t");
    await log(a.tenantId, a.userId, "auth.login", { ipAddress: "203.0.113.9" });
    await log(a.tenantId, a.userId, "auth.login", { ipAddress: "198.51.100.2" });
    const hit = await searchAudit({
      tenantId: a.tenantId,
      period: "all",
      kind: "all",
      q: "203.0.113",
    });
    expect(hit).toHaveLength(1);
    expect(hit[0].ipAddress).toContain("203.0.113.9");
  });

  it("없는 아이디로 친 시도도 검색된다 — 사용자에 안 걸린 줄이라 metadata 로만 찾힌다", async () => {
    const a = await seed("as-nx", "as-nx@t");
    await log(a.tenantId, null, "auth.login_failed", {
      metadata: { via: "browser", reason: "no_such_user", attemptedId: "haxor" },
    });
    const hit = await searchAudit({
      tenantId: a.tenantId,
      period: "all",
      kind: "all",
      q: "haxor",
    });
    expect(hit).toHaveLength(1);
    expect(hit[0].actorEmail).toBeNull();
  });

  it("행위자가 지워져도 기록은 남는다", async () => {
    const a = await seed("as-del", "as-del@t");
    await log(a.tenantId, null, "customer.delete", {
      metadata: { name: "사라진거래처" },
    });
    const rows = await searchAudit({
      tenantId: a.tenantId,
      period: "all",
      kind: "all",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorEmail).toBeNull();
    expect((rows[0].metadata as { name: string }).name).toBe("사라진거래처");
  });
});
