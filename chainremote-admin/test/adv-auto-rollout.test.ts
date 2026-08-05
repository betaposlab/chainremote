// 적대적 테스트 — 자동 롤아웃(autoQueueIfBehind, 2026-07-20).
//
// 대상: lib/data/pending-updates.ts::autoQueueIfBehind / isVersionNewer.
// heartbeat 가 구버전을 보고하면 서버가 스스로 pending_updates 를 큐잉하는 경로를 경계·악성입력·
// 상태왜곡·멀티테넌트 격리 관점에서 두들긴다. 하네스는 기존 auto-rollout.test.ts 를 그대로 모방.
//
// 결함 후보(의도된 격리 규칙과 실제 동작이 어긋나는 것)는 "결함 후보" describe 로 분리해
// 실패 상태로 남긴다(억지 통과 금지). 나머지는 현 동작을 명시적으로 고정한다.

import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { autoQueueIfBehind, isVersionNewer, pushBulk } from "@/lib/data/pending-updates";
import type { AgentPushMeta } from "@/lib/agent-push-meta";
import { customers, pendingUpdates, tenants, users } from "@/lib/schema";

const META: AgentPushMeta = {
  version: "1.4.62",
  url: "https://x/ChainRemote_Agent_Setup_v1.4.62.exe",
  sha256: "a".repeat(64),
  size: 35_000_000,
  autoRollout: true,
};

interface SeedOpts {
  isInternal?: boolean;
  isActive?: boolean;
  subscriptionStatus?: "active" | "suspended" | "cancelled";
  tenantActive?: boolean;
}

async function seed(slug: string, name: string, remoteId: string, opts: SeedOpts = {}) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({
      slug,
      displayName: slug,
      subscriptionStatus: opts.subscriptionStatus ?? "active",
      isActive: opts.tenantActive ?? true,
    })
    .returning({ id: tenants.id });
  const [c] = await db
    .insert(customers)
    .values({
      tenantId: t.id,
      name,
      remoteId,
      isInternal: opts.isInternal ?? false,
      isActive: opts.isActive ?? true,
    })
    .returning({ id: customers.id });
  return { tenantId: t.id, customerId: c.id };
}

async function rows(customerId: string) {
  const db = testDb();
  return db.select().from(pendingUpdates).where(eq(pendingUpdates.customerId, customerId));
}

// autoQueue 의 상태불문 SELECT / partial-unique 를 우회해 특정 상태의 pending 을 직접 심는다.
async function insertPending(
  tenantId: string,
  customerId: string,
  targetVersion: string,
  status: { appliedAt?: Date; cancelledAt?: Date; failedAt?: Date } = {},
) {
  const db = testDb();
  return db
    .insert(pendingUpdates)
    .values({
      tenantId,
      customerId,
      targetVersion,
      assetUrl: "https://x/whatever.exe",
      assetSha256: "b".repeat(64),
      assetSize: 1_000,
      ...status,
    })
    .returning({ id: pendingUpdates.id });
}

// autoQueue 가 받는 최소 형태의 customer 객체(recordHeartbeat 가 넘기는 것과 동일 shape).
function cust(s: { customerId: string; tenantId: string }, isInternal = false) {
  return { id: s.customerId, tenantId: s.tenantId, isInternal };
}

// ─────────────────────────────────────────────────────────────────────────────
// 버전 비교 경계 (순수 함수)
// ─────────────────────────────────────────────────────────────────────────────
describe("isVersionNewer 경계", () => {
  it("AR-12 세그먼트 비대칭/추가 세그먼트", () => {
    // (a) 누락 자리는 0 채움 → 1.4.0 == 1.4
    expect(isVersionNewer("1.4.0", "1.4")).toBe(false);
    expect(isVersionNewer("1.4", "1.4.0")).toBe(false);
    // (b) 추가 세그먼트가 있으면 그게 더 최신
    expect(isVersionNewer("1.4.62.1", "1.4.62")).toBe(true);
    // (c) 반대로 reported 가 세그먼트 더 길고 크면 meta 는 구버전 → 다운그레이드 금지
    expect(isVersionNewer("1.4.62", "1.4.62.9")).toBe(false);
  });

  it("AR-06 기형 문자열은 0 으로 붕괴(parseInt||0) — meta 가 항상 newer 로 판정", () => {
    // 문서화된 파싱 규약: 파싱 불가 자리는 0. 손상/악성 버전문자열은 [0,..] 으로 취급된다.
    expect(isVersionNewer("1.4.62", "garbage")).toBe(true);
    expect(isVersionNewer("1.4.62", "v1.4.54")).toBe(true); // 'v1' → 0
    expect(isVersionNewer("1.4.62", "??")).toBe(true);
    expect(isVersionNewer("1.4.62", "1.4.x")).toBe(true); // 'x' → 0, [1,4,0] < [1,4,62]
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 큐잉 억제 경로 (의도된 안전핀 — 현 동작 고정)
// ─────────────────────────────────────────────────────────────────────────────
describe("자동 롤아웃 — 큐잉 억제(의도된 동작)", () => {
  it("AR-01 다운그레이드 금지 — reported 가 릴리즈보다 최신이면 큐 안 함", async () => {
    const s = await seed("ar01", "앞선포스", "6000001");
    const queued = await autoQueueIfBehind(cust(s), "1.5.0", META);
    expect(queued).toBe(false);
    expect((await rows(s.customerId)).length).toBe(0);
  });

  it("AR-07 공백/제어문자만 있는 버전은 큐 안 함(trim 가드)", async () => {
    const s = await seed("ar07", "빈버전", "6000007");
    expect(await autoQueueIfBehind(cust(s), "   ", META)).toBe(false);
    expect(await autoQueueIfBehind(cust(s), "\t\n", META)).toBe(false);
    expect(await autoQueueIfBehind(cust(s), "", META)).toBe(false);
    expect((await rows(s.customerId)).length).toBe(0);
  });

  it("AR-11 meta=null(NAS 순단) → false, throw 없음, 행 0", async () => {
    const s = await seed("ar11", "메타없음", "6000011");
    let queued: boolean | undefined;
    await expect(
      (async () => {
        queued = await autoQueueIfBehind(cust(s), "1.4.54", null);
      })(),
    ).resolves.toBeUndefined();
    expect(queued).toBe(false);
    expect((await rows(s.customerId)).length).toBe(0);
  });

  it("AR-12(a) 누락 세그먼트 동일 취급 → 큐 없음, (b) 추가 세그먼트 최신 → 큐 생성", async () => {
    // (a) reported '1.4.62', meta '1.4.62' 동급 계열: '1.4' 를 '1.4.0' 으로 → 동일
    const a = await seed("ar12a", "동급", "6000121");
    expect(await autoQueueIfBehind(cust(a), "1.4.62", META)).toBe(false);
    expect((await rows(a.customerId)).length).toBe(0);

    // (b) reported '1.4.62' 인데 meta 가 '1.4.62.1' → meta 가 newer → 큐
    const b = await seed("ar12b", "추가세그", "6000122");
    expect(await autoQueueIfBehind(cust(b), "1.4.62", { ...META, version: "1.4.62.1" })).toBe(true);
    const rb = await rows(b.customerId);
    expect(rb.length).toBe(1);
    expect(rb[0].targetVersion).toBe("1.4.62.1");

    // (c) reported 가 더 길고 큼 → meta 는 구버전 → 다운그레이드 금지
    const c = await seed("ar12c", "롤백중", "6000123");
    expect(await autoQueueIfBehind(cust(c), "1.4.62.9", META)).toBe(false);
    expect((await rows(c.customerId)).length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 상태왜곡/중복(멱등) — 상태불문 SELECT 가 유일 방어
// ─────────────────────────────────────────────────────────────────────────────
describe("자동 롤아웃 — 재두들김/중복 방지(상태불문 1회)", () => {
  it("AR-02 applied 후 구버전 heartbeat → 1회 재큐잉, 2회째부턴 금지 (2026-08-05 스펙 변경)", async () => {
    // 종전 스펙은 "재큐잉 금지(brick 의심)"였다. 그러나 applied_at 은 에이전트의 설치 완료
    // 보고로만 찍히므로 applied+구버전 = 새 버전을 완주하고 되돌아간 기기(수동 재설치/
    // 다운그레이드)다 — brick 은 완료 보고를 못 해 pending 으로 남는다. 실제로 테스트1 을
    // 1.4.84 로 재설치했더니 서버가 영영 안 끌어올리는 걸 실증하고 스펙을 바꿨다.
    // 재큐잉은 1회 한도 — 또 내려가면 사람 몫(무한 되밀기 루프 차단).
    const s = await seed("ar02", "다운그레이드복귀", "6000002");
    await insertPending(s.tenantId, s.customerId, META.version, { appliedAt: new Date() });
    // 1회차: 다운그레이드 복귀로 판정 → 재큐잉된다.
    const again = await autoQueueIfBehind(cust(s), "1.4.54", META);
    expect(again).toBe(true);
    const r = await rows(s.customerId);
    expect(r.length).toBe(2); // applied 이력 + 새 대기 행
    // 재큐잉된 행이 또 applied 됐는데 다시 구버전 보고 → 이번엔 침묵(1회 한도).
    const db = testDb();
    await db
      .update(pendingUpdates)
      .set({ appliedAt: new Date() })
      .where(eq(pendingUpdates.customerId, s.customerId));
    const third = await autoQueueIfBehind(cust(s), "1.4.54", META);
    expect(third).toBe(false);
    expect((await rows(s.customerId)).length).toBe(2);
  });

  it("AR-02b 일괄푸시 북키핑 cancelled + 그 뒤 applied → 구버전 보고 시 재큐잉된다 (테스트1 실데이터형)", async () => {
    // 일괄 푸시는 기존 대기 행을 cancel 하고 새 행을 얹는다. 그래서 정상 적용된 기계에도
    // (cancelled 옛 행 + applied 새 행) 이력이 남는다 — cancelled 를 "사람 거부"로 읽으면
    // 이 기계들의 다운그레이드 복귀가 전부 막힌다. 판단은 최신 행(applied)으로.
    const s = await seed("ar02b", "북키핑케이스", "6000022");
    const old = new Date(Date.now() - 60_000);
    const db = testDb();
    await db.insert(pendingUpdates).values({
      tenantId: s.tenantId,
      customerId: s.customerId,
      targetVersion: META.version,
      assetUrl: "https://x/whatever.exe",
      assetSha256: "b".repeat(64),
      assetSize: 1_000,
      cancelledAt: old,
      createdAt: old,
    });
    await insertPending(s.tenantId, s.customerId, META.version, { appliedAt: new Date() });
    expect(await autoQueueIfBehind(cust(s), "1.4.54", META)).toBe(true);
    expect((await rows(s.customerId)).length).toBe(3);
  });

  it("AR-02c 최신이 cancelled(진짜 사람 거부) → 구버전 보고여도 침묵", async () => {
    const s = await seed("ar02c", "최신거부", "6000023");
    const old = new Date(Date.now() - 60_000);
    const db = testDb();
    await db.insert(pendingUpdates).values({
      tenantId: s.tenantId,
      customerId: s.customerId,
      targetVersion: META.version,
      assetUrl: "https://x/whatever.exe",
      assetSha256: "b".repeat(64),
      assetSize: 1_000,
      appliedAt: old,
      createdAt: old,
    });
    await insertPending(s.tenantId, s.customerId, META.version, { cancelledAt: new Date() });
    expect(await autoQueueIfBehind(cust(s), "1.4.54", META)).toBe(false);
    expect((await rows(s.customerId)).length).toBe(2);
  });

  it("AR-03 사람이 거부(cancelled)한 자동푸시는 되살리지 않는다", async () => {
    const s = await seed("ar03", "관리자거부", "6000003");
    await insertPending(s.tenantId, s.customerId, META.version, { cancelledAt: new Date() });
    const again = await autoQueueIfBehind(cust(s), "1.4.54", META);
    expect(again).toBe(false);
    const r = await rows(s.customerId);
    expect(r.length).toBe(1);
    expect(r[0].cancelledAt).not.toBeNull();
  });

  it("AR-08 이미 대기 중(all-null)인데 double-fire heartbeat → 이중 큐 금지", async () => {
    const s = await seed("ar08", "중복발사", "6000008");
    expect(await autoQueueIfBehind(cust(s), "1.4.54", META)).toBe(true); // 1차: 대기 행 생성
    expect(await autoQueueIfBehind(cust(s), "1.4.54", META)).toBe(false); // 2차: 상태불문 SELECT 가 막음
    expect((await rows(s.customerId)).length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// partial-unique 인덱스 = 동시 heartbeat 경합의 최종 백스톱
// ─────────────────────────────────────────────────────────────────────────────
describe("자동 롤아웃 — partial-unique 백스톱", () => {
  it("AR-09 같은 (customer,target) all-null 2행은 raw INSERT 도 인덱스가 거부한다", async () => {
    const s = await seed("ar09", "경합", "6000009");
    // autoQueue 가 all-null 대기 행 1개 생성(정상 경로).
    expect(await autoQueueIfBehind(cust(s), "1.4.54", META)).toBe(true);
    // SELECT 를 우회한 진짜 경합 모사: 같은 (customer, 1.4.62) all-null 2번째 행 raw INSERT.
    await expect(insertPending(s.tenantId, s.customerId, META.version)).rejects.toThrow();
    expect((await rows(s.customerId)).length).toBe(1); // 인덱스가 2번째를 막음
  });

  it("AR-09b 처리 끝난 행(applied)에는 partial 조건이 무력 — 같은 키 새 all-null 이 다시 들어간다", async () => {
    // 이것이 AR-02/AR-03 방어를 인덱스가 아니라 오직 앱 SELECT 가 담당하는 이유.
    const s = await seed("ar09b", "인덱스무력", "6000091");
    const [first] = await insertPending(s.tenantId, s.customerId, META.version, { appliedAt: new Date() });
    expect(first.id).toBeTruthy();
    // applied 행은 partial 술어(applied/cancelled/failed 모두 NULL) 밖 → 새 all-null 은 충돌 안 남.
    await expect(insertPending(s.tenantId, s.customerId, META.version)).resolves.toBeTruthy();
    expect((await rows(s.customerId)).length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 수동 일괄푸시와 자동큐의 supersede 불일치 — 현 동작 고정
// ─────────────────────────────────────────────────────────────────────────────
describe("자동 롤아웃 — pushBulk 와의 중첩(supersede 불일치, 현 동작 고정)", () => {
  it("AR-10 운영자 수동 핀(1.4.60)이 있으면 autoQueue 는 물러난다 — 수동 우선(HBI-3)", async () => {
    const db = testDb();
    const s = await seed("ar10", "이중대기", "6000010");
    // 패널 사용자(requested_by FK 충족용) 1명.
    const [u] = await db
      .insert(users)
      .values({ tenantId: s.tenantId, email: "op@ar10", displayName: "op", passwordHash: "x", role: "owner" })
      .returning({ id: users.id });
    // 먼저 수동 일괄푸시로 1.4.60 대기행 생성(운영자 의도 = 핫픽스/롤백 핀).
    await pushBulk(
      { targetVersion: "1.4.60", assetUrl: "https://x/a.exe", assetSha256: "c".repeat(64), assetSize: 2_000 },
      {},
      { tenantId: s.tenantId, requestedBy: u.id },
    );
    const before = await rows(s.customerId);
    expect(before.length).toBe(1);
    expect(before[0].targetVersion).toBe("1.4.60");

    // 이후 구버전 heartbeat → 수동 핀(requested_by 있음)이 걸려 있으므로 autoQueue 는 스킵한다.
    //   에이전트가 desc(createdAt) 로 자동 1.4.62 를 집어 운영자 핀을 덮는 사고(HBI-3)를 막는다.
    expect(await autoQueueIfBehind(cust(s), "1.4.54", META)).toBe(false);
    const after = await rows(s.customerId);
    const active = after.filter((r) => !r.appliedAt && !r.cancelledAt && !r.failedAt);
    // 수동 핀만 남고 자동은 얹히지 않는다.
    expect(active.map((r) => r.targetVersion).sort()).toEqual(["1.4.60"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 악성/손상 버전 — 현 동작 고정(강제 큐잉이 일어남을 못박음)
// ─────────────────────────────────────────────────────────────────────────────
describe("자동 롤아웃 — 기형 버전 강제 큐잉(현 동작 고정)", () => {
  it("AR-06 기형 버전('garbage')은 0.0.0 취급 → 무조건 큐잉된다", async () => {
    // 손상/악성 에이전트가 스스로 강제 재설치를 유발할 수 있음을 명시적으로 고정한다.
    // (안전한 쪽=큐잉 보류가 바람직할 수 있으나 현 코드는 큐잉함 — notes 참고.)
    const s = await seed("ar06", "손상버전", "6000006");
    expect(await autoQueueIfBehind(cust(s), "garbage", META)).toBe(true);
    const r = await rows(s.customerId);
    expect(r.length).toBe(1);
    expect(r[0].targetVersion).toBe("1.4.62");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 결함 후보 — 의도된 격리 규칙(pushBulk 와 동일 대상집합)과 실제 동작 불일치.
// pushBulk 는 is_active=false / 정지 tenant 를 제외하지만 autoQueue 는 아무 상태도 안 본다.
// recordHeartbeat 도 remote_id+token 만으로 매칭(is_active/tenant 상태 미검사)이라 실제로 도달 가능.
// 아래 두 테스트는 "기대(의도)" 를 assert 하므로 현 코드에선 실패한다(억지 통과 금지).
// ─────────────────────────────────────────────────────────────────────────────
// 정책 확정(2026-07-21): 정지/미납·비활성 tenant·거래처도 에이전트 자동 업뎃은 계속한다
//   (과금과 무관하게 최신 유지 — 재개 시 이미 최신이라 공백이 없다). 따라서 autoQueue 는
//   tenant/거래처 활성 상태를 게이트하지 않는 것이 의도된 동작이다. cleanup·롤아웃 모두 동일.
describe("자동 롤아웃 — 정책: 정지·비활성도 최신 유지(게이트 안 함)", () => {
  it("AR-04 오프보딩된 거래처(is_active=false)도 자동 롤아웃 대상", async () => {
    const s = await seed("ar04", "오프보딩", "6000004", { isActive: false });
    const queued = await autoQueueIfBehind(cust(s), "1.4.54", META);
    expect(queued).toBe(true);
    expect((await rows(s.customerId)).length).toBe(1);
  });

  it("AR-05 정지/미납 tenant 소속 거래처도 자동 롤아웃 대상", async () => {
    const s = await seed("ar05", "정지테넌트", "6000005", { subscriptionStatus: "suspended" });
    const queued = await autoQueueIfBehind(cust(s), "1.4.54", META);
    expect(queued).toBe(true);
    expect((await rows(s.customerId)).length).toBe(1);
  });
});
