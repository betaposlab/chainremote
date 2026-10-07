import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { customers, rzNoreplyEpisodes, rzRelayRequests, tenants } from "@/lib/schema";
import { registerHeartbeatToken } from "@/lib/data/customers";
import { POST as heartbeatPOST } from "@/app/api/customers/heartbeat/route";
import { createRzRelayRequest, takeRzRelayRequest } from "@/lib/data/rz-relay";
import { listRzHistory } from "@/lib/data/rz-history";

// 응답 없음 구간 이력 + 대리 전달 거절 기록(마이그 057).
// 대리 전달이 실전에서 안 붙었을 때 "어디서 끊겼나"를 가르는 근거가 남는지 본다.

let seq = 0;
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
async function hb(remoteId: string, token: string, rzNoReplySince: number | null | undefined) {
  seq += 1;
  const body: Record<string, unknown> = { remoteId, version: "1.4.153" };
  if (rzNoReplySince !== undefined) body.rzNoReplySince = rzNoReplySince;
  const r = await heartbeatPOST(
    new Request("http://t/api/customers/heartbeat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.78.0.${seq}`,
        "X-ChainRemote-Token": token,
      },
      body: JSON.stringify(body),
    }),
  );
  expect(r.status).toBe(200);
}
const episodes = (customerId: string) =>
  testDb().select().from(rzNoreplyEpisodes).where(eq(rzNoreplyEpisodes.customerId, customerId));
const nowSec = () => Math.floor(Date.now() / 1000);

describe("응답 없음 구간 이력", () => {
  it("같은 시작 시각이 이어지면 한 구간, null 이 오면 닫힌다", async () => {
    const a = await seed("rzh-a", "RH00000001");
    const since = nowSec() - 600;
    await hb("RH00000001", a.token, since);
    await hb("RH00000001", a.token, since);
    let eps = await episodes(a.customerId);
    expect(eps).toHaveLength(1);
    expect(eps[0].endedAt).toBeNull();
    expect(Math.floor(eps[0].startedAt.getTime() / 1000)).toBe(since);

    await hb("RH00000001", a.token, null);
    eps = await episodes(a.customerId);
    expect(eps).toHaveLength(1);
    expect(eps[0].endedAt).not.toBeNull();
    expect(eps[0].endReason).toBe("cleared");
  });

  it("풀림 없이 다른 시작 시각이 오면 옛 구간은 마지막 보고 시각으로 닫고 새로 연다", async () => {
    const a = await seed("rzh-b", "RH00000002");
    await hb("RH00000002", a.token, nowSec() - 3600);
    const lastSeen = new Date(Date.now() - 30 * 60_000);
    await testDb().update(rzNoreplyEpisodes).set({ lastSeenAt: lastSeen });
    await hb("RH00000002", a.token, nowSec() - 60);
    const eps = (await episodes(a.customerId)).sort((x, y) => x.startedAt.getTime() - y.startedAt.getTime());
    expect(eps).toHaveLength(2);
    expect(eps[0].endReason).toBe("replaced");
    expect(eps[0].endedAt!.getTime()).toBe(lastSeen.getTime());
    expect(eps[1].endedAt).toBeNull();
  });

  it("정상 보고(null)와 옛 에이전트(키 없음)는 구간을 만들지 않는다", async () => {
    const a = await seed("rzh-c", "RH00000003");
    await hb("RH00000003", a.token, null);
    await hb("RH00000003", a.token, undefined);
    expect(await episodes(a.customerId)).toHaveLength(0);
  });
});

describe("대리 전달 기록", () => {
  const req = (tenantId: string, remoteId: string) =>
    createRzRelayRequest({
      tenantId,
      userId: null,
      remoteId,
      hqIp: "182.210.192.200",
      hqPort: 54321,
      relayServer: "relay.626.kr",
    });

  it("거절도 사유와 함께 남고, HQ 응답은 예전 그대로이며, 에이전트는 거절 행을 못 가져간다", async () => {
    const a = await seed("rzh-d", "RH00000004");
    await testDb()
      .update(customers)
      .set({ lastHeartbeatAt: new Date() })
      .where(eq(customers.id, a.customerId));
    expect(await req(a.tenantId, "RH00000004")).toEqual({ ok: false, reason: "not_noreply" });

    // 응답 없음이었지만 보고가 묵은 경우 = stale
    await testDb()
      .update(customers)
      .set({ rzNoreplySince: new Date(Date.now() - 3600_000), lastHeartbeatAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(customers.id, a.customerId));
    expect(await req(a.tenantId, "RH00000004")).toEqual({ ok: false, reason: "not_noreply" });

    const rows = await testDb().select().from(rzRelayRequests).where(eq(rzRelayRequests.customerId, a.customerId));
    expect(rows.map((r) => r.rejectedReason).sort()).toEqual(["not_noreply", "stale"]);
    expect(await takeRzRelayRequest("RH00000004", a.token)).toBeNull();
  });

  it("1시간 지난 요청도 지우지 않는다(30일 보관)", async () => {
    const a = await seed("rzh-e", "RH00000005");
    await testDb()
      .update(customers)
      .set({ rzNoreplySince: new Date(), lastHeartbeatAt: new Date() })
      .where(eq(customers.id, a.customerId));
    await req(a.tenantId, "RH00000005");
    await testDb().update(rzRelayRequests).set({ createdAt: new Date(Date.now() - 2 * 3600_000) });
    await req(a.tenantId, "RH00000005");
    const rows = await testDb().select().from(rzRelayRequests).where(eq(rzRelayRequests.customerId, a.customerId));
    expect(rows).toHaveLength(2);
  });
});

describe("이력 조회", () => {
  it("구간과 요청을 최신순으로 섞어 보여주고, 남의 대리점 것은 안 보인다", async () => {
    const a = await seed("rzh-f", "RH00000006");
    const b = await seed("rzh-g", "RH00000007");
    await hb("RH00000006", a.token, nowSec() - 600);
    await createRzRelayRequest({
      tenantId: a.tenantId,
      userId: null,
      remoteId: "RH00000006",
      hqIp: "1.2.3.4",
      hqPort: 4000,
      relayServer: null,
    });
    await takeRzRelayRequest("RH00000006", a.token);

    const items = await listRzHistory(a.tenantId, a.customerId);
    expect(items.map((i) => i.kind)).toEqual(["relay", "noreply"]);
    const relay = items[0];
    expect(relay.kind === "relay" && relay.consumedAt).not.toBeNull();
    expect(await listRzHistory(b.tenantId, a.customerId)).toHaveLength(0);
  });
});
