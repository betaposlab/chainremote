// 본사 앱 → 관리 패널 티켓 (마이그050). 이 파일이 지키는 성질은 셋이다.
//   ① 한 번 쓰면 사라진다 ② 만료되면 안 통한다 ③ 엿보기는 소비하지 않는다.
//
// ★③ 이 새로 생긴 이유(2026-08-20): 브라우저에 다른 계정이 있으면 곧바로 갈아타지 않고
//   "누구로 바꿀지"를 보여 주고 물어본다. 그 화면을 그리려면 주인을 먼저 알아야 하는데,
//   그러자고 소비해 버리면 정작 [전환] 을 눌렀을 때 쓸 티켓이 없다.

import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  issuePanelTicket,
  consumePanelTicket,
  peekPanelTicket,
} from "@/lib/panel-ticket";
import { panelTickets, tenants, users } from "@/lib/schema";

async function seedUser(slug: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug, isActive: true, subscriptionStatus: "active" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({
      tenantId: t.id,
      email: `${slug}@x.test`,
      passwordHash: "x",
      displayName: slug,
      role: "owner",
    })
    .returning({ id: users.id });
  return u.id;
}

describe("패널 티켓", () => {
  it("발급한 티켓은 주인을 돌려주고, 한 번 쓰면 사라진다", async () => {
    const userId = await seedUser("t-once");
    const token = await issuePanelTicket(userId);

    expect(await consumePanelTicket(token)).toBe(userId);
    // ★재사용 불가 — 주소는 방문기록에 남으므로 이게 이 기능의 핵심 방어다.
    expect(await consumePanelTicket(token)).toBeNull();
  });

  it("평문은 저장되지 않는다 — DB 에는 해시만 있다", async () => {
    const userId = await seedUser("t-hash");
    const token = await issuePanelTicket(userId);
    const rows = await testDb().select().from(panelTickets);
    const mine = rows.filter((r) => r.userId === userId);
    expect(mine.length).toBe(1);
    expect(mine[0].tokenHash).not.toBe(token);
    expect(mine[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("만료된 티켓은 안 통한다", async () => {
    const userId = await seedUser("t-exp");
    const token = await issuePanelTicket(userId);
    await testDb()
      .update(panelTickets)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(panelTickets.userId, userId));
    expect(await consumePanelTicket(token)).toBeNull();
    expect(await peekPanelTicket(token)).toBeNull();
  });

  it("엿보기는 주인을 알려 주되 소비하지 않는다 — 확인창을 띄우고도 전환이 된다", async () => {
    const userId = await seedUser("t-peek");
    const token = await issuePanelTicket(userId);

    expect(await peekPanelTicket(token)).toBe(userId);
    expect(await peekPanelTicket(token)).toBe(userId); // 몇 번을 봐도 안 닳는다
    // 확인창에서 [전환] 을 누른 순간 비로소 소비된다.
    expect(await consumePanelTicket(token)).toBe(userId);
    expect(await peekPanelTicket(token)).toBeNull();
  });

  it("아무 문자열이나 통과하지 않는다", async () => {
    for (const bad of ["", "short", "x".repeat(43)]) {
      expect(await consumePanelTicket(bad)).toBeNull();
      expect(await peekPanelTicket(bad)).toBeNull();
    }
  });
});
