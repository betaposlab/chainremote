import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  PushValidationError,
  getBulkProgress,
  markApplied,
  markFailed,
  pushBulk,
  pushToCustomer,
} from "@/lib/data/pending-updates";
import { customers, pendingUpdates, tenants, users } from "@/lib/schema";
import { hashHeartbeatToken } from "@/lib/heartbeat-token";

// 2026-08-16 감사(A1) 확정 이슈 수정의 회귀 가드.
//   원본 진단: docs/chainremote/audit/round1/A1.md
//   핵심은 "무보고 고착" 방지다 — 잘못된 값이 들어가면 에이전트가 JSON 파싱조차 못 해
//   5분마다 조용히 실패하고, 그 행이 남아 있는 동안 그 거래처는 자동 롤아웃까지 멎는다.

const ASSET = {
  targetVersion: "1.4.132",
  assetUrl: "https://sepani.synology.me/chainremote/ChainRemote_Agent_Setup_v1.4.132.exe",
  assetSha256: "a".repeat(64),
  assetSize: 35_000_000,
};

async function seed(opts?: { lastVersion?: string }) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug: "a1", displayName: "a1" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({
      tenantId: t.id,
      email: "op@x",
      displayName: "op",
      passwordHash: "x",
      role: "owner",
    })
    .returning({ id: users.id });
  const token = "tok-a1";
  const [c] = await db
    .insert(customers)
    .values({
      tenantId: t.id,
      name: "가게",
      remoteId: "211191101",
      heartbeatToken: hashHeartbeatToken(token),
      ...(opts?.lastVersion ? { lastVersion: opts.lastVersion } : {}),
    })
    .returning({ id: customers.id });
  return { tenantId: t.id, userId: u.id, customerId: c.id, token };
}

function ctxOf(s: { tenantId: string; userId: string }) {
  return { tenantId: s.tenantId, requestedBy: s.userId };
}

describe("A1-2/A1-3 잘못된 푸시 값은 서버가 막는다", () => {
  it("시작==종료 시각은 거부 — 통과하면 그 거래처는 영원히 대기(보고도 없음)", async () => {
    const s = await seed();
    await expect(
      pushToCustomer(s.customerId, ASSET, { windowStartHour: 3, windowEndHour: 3 }, ctxOf(s)),
    ).rejects.toBeInstanceOf(PushValidationError);
    expect(await testDb().select().from(pendingUpdates)).toHaveLength(0);
  });

  it("음수·범위 밖 시각은 거부 — 에이전트 JSON 파싱이 통째로 깨지던 값", async () => {
    const s = await seed();
    for (const opts of [
      { windowStartHour: -1, windowEndHour: 7 },
      { windowStartHour: 0, windowEndHour: 25 },
      { windowStartHour: 1.5, windowEndHour: 7 },
    ]) {
      await expect(pushToCustomer(s.customerId, ASSET, opts, ctxOf(s))).rejects.toBeInstanceOf(
        PushValidationError,
      );
    }
  });

  it("음수·과대 분산 시간은 거부", async () => {
    const s = await seed();
    for (const r of [-60, 90_000, 1.5]) {
      await expect(
        pushToCustomer(s.customerId, ASSET, { randomizeMaxSec: r }, ctxOf(s)),
      ).rejects.toBeInstanceOf(PushValidationError);
    }
  });

  it("sha·버전·크기·주소 형식도 막는다", async () => {
    const s = await seed();
    const bad = [
      { ...ASSET, assetSha256: "deadbeef" },
      { ...ASSET, targetVersion: "1.4" },
      { ...ASSET, targetVersion: "v1.4.132" },
      { ...ASSET, assetSize: 0 },
      { ...ASSET, assetUrl: "ftp://x/y.exe" },
    ];
    for (const a of bad) {
      await expect(pushToCustomer(s.customerId, a, {}, ctxOf(s))).rejects.toBeInstanceOf(
        PushValidationError,
      );
    }
  });

  it("정상 값은 그대로 통과한다(회귀 방지)", async () => {
    const s = await seed();
    const row = await pushToCustomer(
      s.customerId,
      ASSET,
      { windowStartHour: 0, windowEndHour: 7, randomizeMaxSec: 600 },
      ctxOf(s),
    );
    expect(row?.id).toBeTruthy();
  });

  it("일괄 푸시도 같은 검증을 탄다", async () => {
    const s = await seed();
    await expect(
      pushBulk(ASSET, { windowStartHour: 5, windowEndHour: 5 }, ctxOf(s)),
    ).rejects.toBeInstanceOf(PushValidationError);
  });
});

describe("A1-1 다운그레이드 푸시는 거부(무동작인데 '적용됨'으로 보이던 것)", () => {
  it("이미 더 높은 버전인 거래처엔 단건 푸시가 막힌다", async () => {
    const s = await seed({ lastVersion: "1.4.132" });
    await expect(
      pushToCustomer(s.customerId, { ...ASSET, targetVersion: "1.4.113" }, {}, ctxOf(s)),
    ).rejects.toBeInstanceOf(PushValidationError);
  });

  it("★같은 버전 재푸시는 허용한다 — 깨진 설치를 되살리는 복구 경로다", async () => {
    const s = await seed({ lastVersion: "1.4.132" });
    const row = await pushToCustomer(s.customerId, ASSET, {}, ctxOf(s));
    expect(row?.id).toBeTruthy();
  });

  it("버전 비교는 자릿수로 한다 — 1.4.9 < 1.4.10 (문자열 비교면 반대)", async () => {
    const s = await seed({ lastVersion: "1.4.10" });
    await expect(
      pushToCustomer(s.customerId, { ...ASSET, targetVersion: "1.4.9" }, {}, ctxOf(s)),
    ).rejects.toBeInstanceOf(PushValidationError);
  });

  it("일괄 푸시는 더 높은 버전인 기기를 대상에서 뺀다", async () => {
    const s = await seed({ lastVersion: "1.4.140" });
    const db = testDb();
    await db.insert(customers).values({
      tenantId: s.tenantId,
      name: "옛버전가게",
      remoteId: "111222333",
      lastVersion: "1.4.100",
    });
    const r = await pushBulk(ASSET, {}, ctxOf(s));
    expect(r.inserted).toBe(1); // 1.4.140 기기는 빠지고 1.4.100 기기만
  });

  it("형식이 x.y.z 가 아닌 옛 보고는 판단을 보류하고 대상에 남긴다", async () => {
    const s = await seed({ lastVersion: "unknown-build" });
    const r = await pushBulk(ASSET, {}, ctxOf(s));
    expect(r.inserted).toBe(1);
  });
});

describe("A1-5 같은 보고 재전송은 성공으로 친다(멱등)", () => {
  it("applied 를 두 번 보내도 두 번째가 실패하지 않는다", async () => {
    const s = await seed();
    const row = await pushToCustomer(s.customerId, ASSET, {}, ctxOf(s));
    expect(await markApplied(row!.id, "211191101", s.token)).toBe(true);
    // 응답이 유실돼 에이전트가 재전송하는 상황 — 종전엔 403 이라 재전송 슬롯이 안 비워졌다.
    expect(await markApplied(row!.id, "211191101", s.token)).toBe(true);
  });

  it("failed 재전송도 멱등", async () => {
    const s = await seed();
    const row = await pushToCustomer(s.customerId, ASSET, {}, ctxOf(s));
    expect(await markFailed(row!.id, "211191101", s.token, "download failed")).toBe(true);
    expect(await markFailed(row!.id, "211191101", s.token, "download failed")).toBe(true);
  });

  it("남의 토큰으로는 여전히 못 보고한다(회귀 방지)", async () => {
    const s = await seed();
    const row = await pushToCustomer(s.customerId, ASSET, {}, ctxOf(s));
    expect(await markApplied(row!.id, "211191101", "wrong-token")).toBe(false);
  });
});

describe("A1-6 일괄 진행률이 음수가 되지 않는다", () => {
  it("취소한 뒤 도착한 applied 가 있어도 pending 이 음수가 아니다", async () => {
    const s = await seed();
    const r = await pushBulk(ASSET, {}, ctxOf(s));
    const [row] = await testDb()
      .select({ id: pendingUpdates.id })
      .from(pendingUpdates)
      .where(eq(pendingUpdates.bulkBatchId, r.bulkBatchId));
    // 취소 — 그런데 이미 내려받은 에이전트가 설치하고 보고한다(pull 모델이라 막을 수 없다).
    await testDb()
      .update(pendingUpdates)
      .set({ cancelledAt: new Date() })
      .where(eq(pendingUpdates.id, row.id));
    await testDb()
      .update(pendingUpdates)
      .set({ appliedAt: new Date() })
      .where(eq(pendingUpdates.id, row.id));

    const p = await getBulkProgress(r.bulkBatchId, { tenantId: s.tenantId });
    expect(p.pending).toBeGreaterThanOrEqual(0);
    expect(p.applied + p.cancelled + p.failed + p.pending).toBe(p.total);
    expect(p.applied).toBe(1); // 겹치면 applied 우선
    expect(p.cancelled).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-08-16 감사 A5·S4 수정의 회귀 가드 (같은 날 배치라 이 파일에 함께 둔다).
// ─────────────────────────────────────────────────────────────────────────────
import { closeOrphanSessions, startSession } from "@/lib/data/sessions";
import { activeLoginSessions, supportSessions } from "@/lib/schema";
import { jsonError, stripNul } from "@/lib/api-auth";
import { sql } from "drizzle-orm";

describe("A5 고아 세션 — HQ 가 살아 있어도 12시간 넘으면 마감", () => {
  it("좌석이 멀쩡해도 12시간 넘은 세션은 닫힌다(종전엔 영원히 '지원 중')", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.userId,
      customerId: s.customerId,
      remoteId: "211191101",
    });
    // HQ 는 켜져 있다 — 좌석 하트비트가 방금 들어왔다.
    await testDb().insert(activeLoginSessions).values({
      userId: s.userId,
      jti: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      deviceId: "d",
      deviceLabel: "d",
      lastSeenAt: sql`now()`,
    });
    // 13시간 전에 시작된 세션.
    await testDb()
      .update(supportSessions)
      .set({ startedAt: sql`now() - interval '13 hours'` })
      .where(eq(supportSessions.id, sess.id));

    expect(await closeOrphanSessions(s.tenantId)).toBe(1);
    const [row] = await testDb()
      .select({ endedAt: supportSessions.endedAt })
      .from(supportSessions)
      .where(eq(supportSessions.id, sess.id));
    expect(row.endedAt).not.toBeNull();
  });

  it("좌석이 살아 있고 12시간 안 지난 세션은 그대로 둔다(정상 원격 보호)", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.userId,
      customerId: s.customerId,
      remoteId: "211191101",
    });
    await testDb().insert(activeLoginSessions).values({
      userId: s.userId,
      jti: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      deviceId: "d",
      deviceLabel: "d",
      lastSeenAt: sql`now()`,
    });
    await testDb()
      .update(supportSessions)
      .set({ startedAt: sql`now() - interval '3 hours'` })
      .where(eq(supportSessions.id, sess.id));
    expect(await closeOrphanSessions(s.tenantId)).toBe(0);
  });
});

describe("S4 DB 에러가 응답으로 새지 않는다 (CWE-209)", () => {
  it("SQL·파라미터가 실린 에러는 일반 문구로 바뀐다", async () => {
    const leaky = new Error(
      'Failed query: insert into "customers" ("tenant_id","name") values ($1,$2) ' +
        "-- params: 9a1d5fe4-e616-42c0-9e23-87b1bbd69b1f, 가게",
    );
    const res = jsonError(leaky);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("처리 중 오류가 발생했습니다.");
    expect(body.error).not.toContain("insert into");
    expect(body.error).not.toContain("9a1d5fe4");
  });

  it("NUL 은 저장 전에 걸러진다", () => {
    const nul = String.fromCharCode(0);
    expect(stripNul(`가게${nul}이름`)).toBe("가게이름");
    expect(stripNul(null)).toBeNull();
  });

  it("사람에게 보여줘야 하는 에러는 그대로 나간다(회귀 방지)", async () => {
    const res = jsonError(new Error("이미 등록된 원격 ID"));
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("이미 등록된");
  });
});

describe("S2-S8 스테이징 버전은 일괄 푸시로 못 나간다", () => {
  it("auto_rollout:false 버전의 일괄 푸시는 거부된다", async () => {
    const s = await seed();
    const mod = await import("@/lib/agent-push-meta");
    const spy = vi
      .spyOn(mod, "getAgentPushMetaCached")
      .mockResolvedValue({
        version: ASSET.targetVersion,
        url: ASSET.assetUrl,
        sha256: ASSET.assetSha256,
        size: ASSET.assetSize,
        autoRollout: false,
      });
    await expect(pushBulk(ASSET, {}, ctxOf(s))).rejects.toBeInstanceOf(PushValidationError);
    spy.mockRestore();
  });

  it("단건 푸시는 스테이징이어도 통과한다 — 실기기 검증 경로다", async () => {
    const s = await seed();
    const mod = await import("@/lib/agent-push-meta");
    const spy = vi.spyOn(mod, "getAgentPushMetaCached").mockResolvedValue({
      version: ASSET.targetVersion,
      url: ASSET.assetUrl,
      sha256: ASSET.assetSha256,
      size: ASSET.assetSize,
      autoRollout: false,
    });
    const row = await pushToCustomer(s.customerId, ASSET, {}, ctxOf(s));
    expect(row?.id).toBeTruthy();
    spy.mockRestore();
  });

  it("검증이 끝난(auto_rollout:true) 버전은 일괄 푸시가 정상 동작한다(회귀 방지)", async () => {
    const s = await seed();
    const mod = await import("@/lib/agent-push-meta");
    const spy = vi.spyOn(mod, "getAgentPushMetaCached").mockResolvedValue({
      version: ASSET.targetVersion,
      url: ASSET.assetUrl,
      sha256: ASSET.assetSha256,
      size: ASSET.assetSize,
      autoRollout: true,
    });
    const r = await pushBulk(ASSET, {}, ctxOf(s));
    expect(r.inserted).toBe(1);
    spy.mockRestore();
  });
});

describe("S1 DB 연결 장애도 응답으로 안 샌다", () => {
  it("ECONNREFUSED 원문(호스트·포트)이 바디에 안 실린다", async () => {
    const res = jsonError(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("처리 중 오류가 발생했습니다.");
    expect(body.error).not.toContain("5432");
  });
});
