// 로그인 기록 — 성공·실패·takeover 가 실제로 남는가.
//
// 여태 로그인은 아무 데도 안 남았다. 그래서 "그 대리점이 들어와 봤나"를 하트비트·
// 활성좌석·지원기록으로 간접 추론해야 했다(2026-09-04). 이 테스트가 잠그는 건 둘이다:
//   ① 남는다 — 그리고 users.last_login_at 도 같이 채워진다
//   ② ★담기는 항목이 딱 셋뿐이다 — 실패 로그가 자격증명 저장소가 되면 최악이라,
//      항목이 늘어나는 순간 테스트가 먼저 터지게 해 둔다
//
// 그리고 세 로그인 경로(브라우저·HQ·takeover)가 전부 이 창구를 쓰는지도 소스로 확인한다.
// 각자 기록하게 두면 한 곳이 빠지는 날이 오고, 빠진 건 필요해질 때까지 안 보인다.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { tenants, users, auditLogs } from "@/lib/schema";
import { recordLoginSuccess, recordLoginFailure } from "@/lib/data/login-audit";

async function makeUser(slug: string, email: string) {
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
      displayName: email,
      role: "owner",
    })
    .returning({ id: users.id });
  return { tenantId: t.id, userId: u.id };
}

describe("로그인 기록", () => {
  it("성공하면 auth.login 이 남고 last_login_at 이 채워진다", async () => {
    const db = testDb();
    const { tenantId, userId } = await makeUser("la-ok", "la-ok@t");

    const before = await db.select().from(users).where(eq(users.id, userId));
    expect(before[0].lastLoginAt).toBeNull();

    await recordLoginSuccess({ userId, tenantId, via: "browser" });

    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("auth.login");
    expect((rows[0].metadata as { via: string }).via).toBe("browser");

    const after = await db.select().from(users).where(eq(users.id, userId));
    expect(after[0].lastLoginAt).not.toBeNull();
  });

  it("takeover 는 따로 구분해 남는다", async () => {
    const db = testDb();
    const { tenantId, userId } = await makeUser("la-to", "la-to@t");
    await recordLoginSuccess({
      userId,
      tenantId,
      via: "takeover",
      deviceLabel: "jaesung-pc",
    });
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.userId, userId));
    expect(rows[0].action).toBe("auth.takeover");
    expect((rows[0].metadata as { device: string }).device).toBe("jaesung-pc");
  });

  it("실패는 사유를 구분해 남는다 — 대입 시도와 오타를 가르려면 필요하다", async () => {
    const db = testDb();
    const { tenantId, userId } = await makeUser("la-ng", "la-ng@t");
    await recordLoginFailure({
      attemptedId: "la-ng@t",
      reason: "bad_password",
      userId,
      tenantId,
      via: "hq",
    });
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.userId, userId));
    expect(rows[0].action).toBe("auth.login_failed");
    expect((rows[0].metadata as { reason: string }).reason).toBe("bad_password");
  });

  it("없는 아이디로 친 시도도 남는다 (사용자엔 안 걸린다)", async () => {
    const db = testDb();
    await recordLoginFailure({
      attemptedId: "존재하지않는아이디",
      reason: "no_such_user",
      via: "browser",
    });
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "auth.login_failed"));
    const hit = rows.find(
      (r) =>
        (r.metadata as { attemptedId?: string })?.attemptedId ===
        "존재하지않는아이디",
    );
    expect(hit).toBeTruthy();
    expect(hit!.userId).toBeNull();
  });

  it("★남기는 항목이 딱 셋이다 — 늘리면 여기서 걸린다", async () => {
    const db = testDb();
    const { tenantId, userId } = await makeUser("la-pw", "la-pw@t");
    await recordLoginFailure({
      attemptedId: "la-pw@t",
      reason: "bad_password",
      userId,
      tenantId,
      via: "browser",
    });
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.userId, userId));
    // 비번을 남기지 않는다는 걸 "password 라는 글자가 없다"로 검사하면 안 된다 —
    //   사유 코드 자체가 bad_password 라 늘 걸린다(실제로 처음에 그렇게 짜서 틀렸다).
    //   대신 담기는 열쇠를 못 박는다. 나중에 누가 항목을 늘리면 여기서 먼저 터진다.
    expect(Object.keys(rows[0].metadata as object).sort()).toEqual([
      "attemptedId",
      "reason",
      "via",
    ]);
  });

  it("긴 아이디는 잘라 담는다", async () => {
    const db = testDb();
    await recordLoginFailure({
      attemptedId: "z".repeat(500),
      reason: "no_such_user",
      via: "browser",
    });
    const rows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "auth.login_failed"));
    const hit = rows.find((r) =>
      ((r.metadata as { attemptedId?: string })?.attemptedId ?? "").startsWith(
        "zzz",
      ),
    );
    expect((hit!.metadata as { attemptedId: string }).attemptedId.length).toBe(
      120,
    );
  });
});

// 세 경로가 전부 창구를 지나는지 소스로 본다. 한 곳이 직접 남기기 시작하면 규칙이 갈리고,
// 갈린 건 사고가 나서 로그를 뒤질 때까지 안 보인다.
describe("로그인 경로 — 전수", () => {
  const paths = [
    "auth.ts",
    "app/api/auth/token/route.ts",
    "app/api/auth/takeover/route.ts",
  ];
  for (const p of paths) {
    it(`${p} 가 login-audit 창구를 쓴다`, () => {
      const src = fs.readFileSync(p, "utf8");
      expect(src).toContain("@/lib/data/login-audit");
      expect(src).toContain("recordLoginSuccess");
      expect(src).toContain("recordLoginFailure");
    });
  }
});
