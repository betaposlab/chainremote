import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { customerAlerts, customers, tenants, vanRestartResets } from "@/lib/schema";
import { recordHeartbeat, registerHeartbeatToken, setVanWatch } from "@/lib/data/customers";
import { listVanResets, resetVanCounters } from "@/lib/data/van-reset";

// VAN 재시작 카운터 초기화 + 마지막 판정 시각(마이그 058).
// 포스 교체 뒤 옛 기기의 숫자가 새 기기 옆에 붙던 것(중앙리 43회)을 접어 두고 0 부터 다시 센다.

async function seed(slug: string, remoteId: string) {
  const db = testDb();
  const [t] = await db.insert(tenants).values({ slug, displayName: slug }).returning({ id: tenants.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name: slug, remoteId })
    .returning({ id: customers.id });
  const token = (await registerHeartbeatToken(remoteId))!;
  return { tenantId: t.id, customerId: c.id, token };
}
const beat = (id: string, token: string, extras: Record<string, unknown>) =>
  recordHeartbeat(id, token, "1.4.153", undefined, undefined, undefined, undefined, extras);
async function row(remoteId: string) {
  const [r] = await testDb().select().from(customers).where(eq(customers.remoteId, remoteId)).limit(1);
  return r;
}

describe("카운터 초기화", () => {
  it("지금 숫자를 이력으로 접고 현재 칸을 0 으로 — 관제 설정과 현재 상태는 그대로", async () => {
    const s = await seed("vr-a", "VR00000001");
    await setVanWatch("VR00000001", "ksnet", s.tenantId);
    await beat("VR00000001", s.token, { vanOk: false, vanRestarted: true });
    await beat("VR00000001", s.token, { vanOk: true, vanRestarted: true });
    let r = await row("VR00000001");
    expect([r.vanRestartCount, r.vanRecoveredCount, r.vanUnrecoveredCount]).toEqual([2, 1, 1]);
    expect(r.vanLastRestartAt).not.toBeNull();

    expect(
      await resetVanCounters({ tenantId: s.tenantId, customerId: s.customerId, userId: null, reason: " 포스 교체 " }),
    ).toEqual({ ok: true });

    r = await row("VR00000001");
    expect([r.vanRestartCount, r.vanRecoveredCount, r.vanUnrecoveredCount]).toEqual([0, 0, 0]);
    expect(r.vanLastRestartAt).toBeNull();
    expect(r.vanResetAt).not.toBeNull();
    expect(r.vanWatch).toBe("ksnet");
    expect(r.vanOk).toBe(true);

    const hist = await listVanResets(s.tenantId, s.customerId);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({
      remoteId: "VR00000001",
      vanKind: "ksnet",
      restartCount: 2,
      recoveredCount: 1,
      unrecoveredCount: 1,
      periodFrom: null,
      reason: "포스 교체",
      by: null,
    });
    expect(hist[0].lastRestartAt).not.toBeNull();
  });

  it("두 번째 초기화의 구간 시작은 첫 초기화 시각이고, 그 뒤 재시작은 0 부터 센다", async () => {
    const s = await seed("vr-b", "VR00000002");
    await setVanWatch("VR00000002", "ksnet", s.tenantId);
    await beat("VR00000002", s.token, { vanOk: true, vanRestarted: true });
    await resetVanCounters({ tenantId: s.tenantId, customerId: s.customerId, userId: null, reason: null });
    const first = (await row("VR00000002")).vanResetAt!;

    await beat("VR00000002", s.token, { vanOk: true, vanRestarted: true });
    expect((await row("VR00000002")).vanRestartCount).toBe(1);
    await resetVanCounters({ tenantId: s.tenantId, customerId: s.customerId, userId: null, reason: null });

    const hist = await listVanResets(s.tenantId, s.customerId);
    expect(hist).toHaveLength(2);
    expect(hist[0].periodFrom?.getTime()).toBe(first.getTime());
    expect(hist[0].restartCount).toBe(1);
    expect(hist[1].periodFrom).toBeNull();
  });

  it("셀 게 없으면(이미 0) 빈 이력을 남기지 않는다", async () => {
    const s = await seed("vr-c", "VR00000003");
    await setVanWatch("VR00000003", "ksnet", s.tenantId);
    expect(
      await resetVanCounters({ tenantId: s.tenantId, customerId: s.customerId, userId: null, reason: null }),
    ).toEqual({ ok: false, reason: "nothing" });
    expect(await testDb().select().from(vanRestartResets)).toHaveLength(0);
  });

  it("남의 대리점 거래처는 못 건드리고 이력도 안 보인다", async () => {
    const a = await seed("vr-d", "VR00000004");
    const b = await seed("vr-e", "VR00000005");
    await setVanWatch("VR00000004", "ksnet", a.tenantId);
    await beat("VR00000004", a.token, { vanOk: true, vanRestarted: true });
    expect(
      await resetVanCounters({ tenantId: b.tenantId, customerId: a.customerId, userId: null, reason: null }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect((await row("VR00000004")).vanRestartCount).toBe(1);
    await resetVanCounters({ tenantId: a.tenantId, customerId: a.customerId, userId: null, reason: null });
    expect(await listVanResets(b.tenantId, a.customerId)).toHaveLength(0);
    expect(await listVanResets(a.tenantId, a.customerId)).toHaveLength(1);
  });
});

describe("숫자를 쌓은 기기", () => {
  it("포스 교체 뒤 초기화하면 이력의 기기는 지금 기기가 아니라 마지막 재시작 때 기기다", async () => {
    const s = await seed("vr-g", "VR00000007");
    await setVanWatch("VR00000007", "ksnet", s.tenantId);
    await beat("VR00000007", s.token, { vanOk: true, vanRestarted: true });
    // 그 뒤 포스 교체 — 서버의 교체 처리가 남기는 것과 같은 모양(알림 + 행의 기기 ID 교체).
    await testDb().insert(customerAlerts).values({
      tenantId: s.tenantId,
      customerId: s.customerId,
      type: "device_replaced",
      detail: JSON.stringify({ from: "VR00000007", to: "NEW0000007", name: "vr-g" }),
      createdAt: new Date(Date.now() + 1000),
    });
    await testDb().update(customers).set({ remoteId: "NEW0000007" }).where(eq(customers.id, s.customerId));

    expect(
      await resetVanCounters({ tenantId: s.tenantId, customerId: s.customerId, userId: null, reason: "포스 교체" }),
    ).toEqual({ ok: true });
    const [h] = await listVanResets(s.tenantId, s.customerId);
    expect(h.remoteId).toBe("VR00000007");
  });

  it("교체가 마지막 재시작보다 먼저였으면 지금 기기가 맞다", async () => {
    const s = await seed("vr-h", "VR00000008");
    await setVanWatch("VR00000008", "ksnet", s.tenantId);
    await testDb().insert(customerAlerts).values({
      tenantId: s.tenantId,
      customerId: s.customerId,
      type: "device_replaced",
      detail: JSON.stringify({ from: "OLD0000008", to: "VR00000008", name: "vr-h" }),
      createdAt: new Date(Date.now() - 60_000),
    });
    await beat("VR00000008", s.token, { vanOk: true, vanRestarted: true });
    await resetVanCounters({ tenantId: s.tenantId, customerId: s.customerId, userId: null, reason: null });
    const [h] = await listVanResets(s.tenantId, s.customerId);
    expect(h.remoteId).toBe("VR00000008");
  });
});

describe("마지막 판정 시각(van_reported_at)", () => {
  it("관제가 켜진 거래처에서 vanOk 가 실려 올 때만 찍히고, VAN 을 바꾸면 비운다", async () => {
    const s = await seed("vr-f", "VR00000006");
    // 관제 off — 뭐가 와도 안 찍힌다(끄기 직전 출발한 늦은 보고 포함).
    await beat("VR00000006", s.token, { vanOk: true });
    expect((await row("VR00000006")).vanReportedAt).toBeNull();

    await setVanWatch("VR00000006", "ksnet", s.tenantId);
    // 키가 없는 보고(옛 에이전트)는 손대지 않는다.
    await beat("VR00000006", s.token, {});
    expect((await row("VR00000006")).vanReportedAt).toBeNull();
    // null(판정 보류)도 "확인은 했다" 는 보고다.
    await beat("VR00000006", s.token, { vanOk: null });
    const t1 = (await row("VR00000006")).vanReportedAt;
    expect(t1).not.toBeNull();
    await beat("VR00000006", s.token, { vanOk: true });
    expect((await row("VR00000006")).vanReportedAt!.getTime()).toBeGreaterThanOrEqual(t1!.getTime());

    await setVanWatch("VR00000006", "nice", s.tenantId);
    expect((await row("VR00000006")).vanReportedAt).toBeNull();
  });
});
