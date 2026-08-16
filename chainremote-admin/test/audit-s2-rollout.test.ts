// S2 라운드2 감사 — 설치·업데이트에서 "꽝"(원격 불능=방문 재설치) 나는 상황.
//
// 대상: lib/data/pending-updates.ts (pushToCustomer/pushBulk vs autoQueueIfBehind).
// 시나리오8 확인용: agent-push.json 이 auto_rollout:false(스테이징) 로 발행됐을 때,
//   자동 롤아웃(heartbeat 트리거)은 막히지만 **단건/일괄 푸시 버튼은 그 게이트를 아예 모른다**는
//   가설을 pushToCustomer/pushBulk 의 실제 시그니처·동작으로 확인한다.
//
// 소스는 절대 수정하지 않는다 — 테스트만. 억지 통과 없음(실제 동작을 있는 그대로 고정).

import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  pushToCustomer,
  pushBulk,
  autoQueueIfBehind,
} from "@/lib/data/pending-updates";
import type { AgentPushMeta } from "@/lib/agent-push-meta";
import { customers, pendingUpdates, tenants, users } from "@/lib/schema";

async function seed(slug: string, name: string, remoteId: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug, isActive: true, subscriptionStatus: "active" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({ tenantId: t.id, email: `${slug}@x.test`, passwordHash: "x", displayName: slug, role: "owner" })
    .returning({ id: users.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name, remoteId, isInternal: false, isActive: true })
    .returning({ id: customers.id });
  return { tenantId: t.id, customerId: c.id, userId: u.id };
}

// AgentPushMeta 가 auto_rollout:false 로 발행된 "스테이징" 상태를 흉내낸다
// (deploy/publish/publish-agent-push-meta.sh 의 AUTO_ROLLOUT=0 경로와 동일 shape).
const STAGING_META: AgentPushMeta = {
  version: "1.4.125",
  url: "https://x/ChainRemote_Agent_Setup_v1.4.125.exe",
  sha256: "c".repeat(64),
  size: 35_000_000,
  autoRollout: false,
};

describe("S2-08: 스테이징(auto_rollout:false) 우회 — 단건/일괄 푸시는 auto_rollout 을 모른다", () => {
  it("결함 후보 — autoQueueIfBehind 는 스테이징이면 절대 큐잉하지 않는다(설계대로)", async () => {
    const { tenantId, customerId } = await seed("dealer-a", "명품한우", "RID-AAA-1");
    const queued = await autoQueueIfBehind(
      { id: customerId, tenantId, isInternal: false },
      "1.4.120", // 현재 구버전 보고
      STAGING_META,
    );
    expect(queued).toBe(false);
    const rows = await testDb()
      .select()
      .from(pendingUpdates)
      .where(eq(pendingUpdates.customerId, customerId));
    expect(rows.length).toBe(0);
  });

  it("결함 후보 — pushToCustomer 는 auto_rollout 인자 자체가 없다: 스테이징 버전도 그대로 큐잉된다", async () => {
    const { tenantId, customerId, userId } = await seed("dealer-a", "명품한우", "RID-AAA-2");
    // pushToCustomer 시그니처엔 AgentPushMeta/auto_rollout 자리가 없다 — 패널 [최신 가져오기]가
    // agent-push.json 을 그대로 폼에 채워 넣고 그 폼 값을 여기로 곧장 넘긴다(app/customers/_push-buttons.tsx
    // handleAutoFill → pushToCustomerAction → 이 함수). 스테이징 여부를 판단할 신호가 애초에 없다.
    const row = await pushToCustomer(
      customerId,
      {
        targetVersion: STAGING_META.version,
        assetUrl: STAGING_META.url,
        assetSha256: STAGING_META.sha256,
        assetSize: STAGING_META.size,
      },
      {},
      { tenantId, requestedBy: userId },
    );
    expect(row).not.toBeNull();
    const rows = await testDb()
      .select()
      .from(pendingUpdates)
      .where(eq(pendingUpdates.customerId, customerId));
    expect(rows.length).toBe(1);
    expect(rows[0].targetVersion).toBe("1.4.125");
    // ★이게 결함의 핵심: autoQueueIfBehind 는 같은 메타로 막았는데(위 테스트),
    //   pushToCustomer 는 같은 스테이징 버전을 아무 저항 없이 큐에 넣는다 — 그 거래처 PC 는
    //   다음 폴링(최대 5분)에 이 버전을 사일런트 설치한다.
  });

  // ★2026-08-16 수정됨 — 감사가 지적한 그날 막았다. 아래는 회귀 가드다.
  //   단건은 여전히 통과한다(위 테스트) — 실기기 검증이 그 경로이기 때문이다.
  it("스테이징 버전의 **일괄** 푸시는 거부된다 — 플릿 전체에 미검증 빌드가 깔리는 걸 막는다", async () => {
    const { tenantId, userId } = await seed("dealer-b", "낭성정육", "RID-BBB-1");
    await expect(
      pushBulk(
        {
          targetVersion: STAGING_META.version,
          assetUrl: STAGING_META.url,
          assetSha256: STAGING_META.sha256,
          assetSize: STAGING_META.size,
        },
        {},
        { tenantId, requestedBy: userId },
      ),
    ).rejects.toThrow(/스테이징/);
  });
});
