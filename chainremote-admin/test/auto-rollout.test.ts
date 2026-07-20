// 자동 롤아웃(2026-07-20) — heartbeat 구버전 보고 → 서버가 스스로 업데이트 큐잉.
// 계약: 내부기기 제외 / (거래처,버전) 1회만(상태 불문 — brick·거부·실패를 자동 재두들김 금지) /
// 킬스위치(auto_rollout:false) / 어떤 실패도 무해.

import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { autoQueueIfBehind, isVersionNewer } from "@/lib/data/pending-updates";
import type { AgentPushMeta } from "@/lib/agent-push-meta";
import { customers, pendingUpdates, tenants } from "@/lib/schema";

const META: AgentPushMeta = {
  version: "1.4.62",
  url: "https://x/ChainRemote_Agent_Setup_v1.4.62.exe",
  sha256: "a".repeat(64),
  size: 35_000_000,
  autoRollout: true,
};

async function seed(slug: string, name: string, remoteId: string, isInternal = false) {
  const db = testDb();
  const [t] = await db.insert(tenants).values({ slug, displayName: slug }).returning({ id: tenants.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name, remoteId, isInternal })
    .returning({ id: customers.id });
  return { tenantId: t.id, customerId: c.id };
}

async function rows(customerId: string) {
  const db = testDb();
  return db.select().from(pendingUpdates).where(eq(pendingUpdates.customerId, customerId));
}

describe("isVersionNewer", () => {
  it("숫자 점 비교", () => {
    expect(isVersionNewer("1.4.62", "1.4.54")).toBe(true);
    expect(isVersionNewer("1.4.62", "1.4.62")).toBe(false);
    expect(isVersionNewer("1.4.9", "1.4.10")).toBe(false);
    expect(isVersionNewer("1.5.0", "1.4.99")).toBe(true);
  });
});

describe("자동 롤아웃", () => {
  it("구버전 보고 → 큐 생성 (당일 창 + 랜덤 분산, requestedBy null)", async () => {
    const s = await seed("ar-a", "준코테스트포스", "6679605");
    const queued = await autoQueueIfBehind(
      { id: s.customerId, tenantId: s.tenantId, isInternal: false },
      "1.4.54",
      META,
    );
    expect(queued).toBe(true);
    const r = await rows(s.customerId);
    expect(r.length).toBe(1);
    expect(r[0].targetVersion).toBe("1.4.62");
    expect(r[0].windowEndHour).toBe(24);
    expect(r[0].requestedBy).toBeNull();
  });

  it("같은 (거래처,버전)은 상태 불문 1회만 — failed/cancelled 를 자동 재두들김 금지", async () => {
    const s = await seed("ar-b", "가게", "7000001");
    await autoQueueIfBehind({ id: s.customerId, tenantId: s.tenantId, isInternal: false }, "1.4.54", META);
    // 실패 처리된 걸로 만들어도
    const db = testDb();
    await db
      .update(pendingUpdates)
      .set({ failedAt: new Date(), failureReason: "test" })
      .where(and(eq(pendingUpdates.customerId, s.customerId), eq(pendingUpdates.targetVersion, "1.4.62")));
    const again = await autoQueueIfBehind(
      { id: s.customerId, tenantId: s.tenantId, isInternal: false },
      "1.4.54",
      META,
    );
    expect(again).toBe(false);
    expect((await rows(s.customerId)).length).toBe(1);
  });

  it("최신 버전/내부기기/킬스위치는 큐 안 만듦", async () => {
    const s = await seed("ar-c", "본사", "7000002", true);
    expect(
      await autoQueueIfBehind({ id: s.customerId, tenantId: s.tenantId, isInternal: true }, "1.4.54", META),
    ).toBe(false);
    const s2 = await seed("ar-d", "최신가게", "7000003");
    expect(
      await autoQueueIfBehind({ id: s2.customerId, tenantId: s2.tenantId, isInternal: false }, "1.4.62", META),
    ).toBe(false);
    expect(
      await autoQueueIfBehind(
        { id: s2.customerId, tenantId: s2.tenantId, isInternal: false },
        "1.4.54",
        { ...META, autoRollout: false },
      ),
    ).toBe(false);
    expect((await rows(s.customerId)).length).toBe(0);
    expect((await rows(s2.customerId)).length).toBe(0);
  });
});
