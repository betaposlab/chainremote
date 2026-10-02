import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { customers, rzRelayRequests, tenants } from "@/lib/schema";
import { registerHeartbeatToken } from "@/lib/data/customers";
import { createRzRelayRequest, takeRzRelayRequest } from "@/lib/data/rz-relay";

// 접속 요청 대리 전달(마이그 056). "응답 없음" PC 에 hbbs 의 PunchHole 대신 패널이 알린다.

async function seed(slug: string, remoteId: string, noreply: boolean) {
  const db = testDb();
  const [t] = await db.insert(tenants).values({ slug, displayName: slug }).returning({ id: tenants.id });
  await db.insert(customers).values({
    tenantId: t.id,
    name: slug,
    remoteId,
    lastHeartbeatAt: new Date(),
    rzNoreplySince: noreply ? new Date(Date.now() - 120_000) : null,
  });
  const token = (await registerHeartbeatToken(remoteId))!;
  return { tenantId: t.id, token };
}
const req = (tenantId: string, remoteId: string, over: Partial<Parameters<typeof createRzRelayRequest>[0]> = {}) =>
  createRzRelayRequest({
    tenantId,
    userId: null,
    remoteId,
    hqIp: "182.210.192.200",
    hqPort: 54321,
    relayServer: "relay.626.kr",
    ...over,
  });

describe("대리 전달 요청 — 남기기", () => {
  it("응답 없음 상태인 자기 대리점 거래처에만 남는다", async () => {
    const a = await seed("rzr-a", "RR00000001", true);
    expect(await req(a.tenantId, "RR00000001")).toMatchObject({ ok: true });
    const b = await seed("rzr-b", "RR00000002", false);
    expect(await req(b.tenantId, "RR00000002")).toEqual({ ok: false, reason: "not_noreply" });
    // 남의 대리점 ID
    expect(await req(b.tenantId, "RR00000001")).toEqual({ ok: false, reason: "not_found" });
  });

  it("보고가 15분 넘게 묵은 응답 없음은 믿지 않는다", async () => {
    const a = await seed("rzr-c", "RR00000003", true);
    await testDb()
      .update(customers)
      .set({ lastHeartbeatAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(customers.remoteId, "RR00000003"));
    expect(await req(a.tenantId, "RR00000003")).toEqual({ ok: false, reason: "not_noreply" });
  });

  it("이상한 주소·포트·중계 서버는 거른다", async () => {
    const a = await seed("rzr-d", "RR00000004", true);
    expect(await req(a.tenantId, "RR00000004", { hqIp: "::1" })).toEqual({ ok: false, reason: "bad_input" });
    expect(await req(a.tenantId, "RR00000004", { hqPort: 0 })).toEqual({ ok: false, reason: "bad_input" });
    expect(await req(a.tenantId, "RR00000004", { hqPort: 70000 })).toEqual({ ok: false, reason: "bad_input" });
    expect(await req(a.tenantId, "RR00000004", { relayServer: "evil host;rm" })).toEqual({ ok: false, reason: "bad_input" });
    // IPv4-mapped 표기는 벗겨서 받는다.
    expect(await req(a.tenantId, "RR00000004", { hqIp: "::ffff:1.2.3.4" })).toMatchObject({ ok: true });
  });
});

describe("대리 전달 요청 — 가져가기", () => {
  it("맞는 토큰이면 한 번만 가져간다", async () => {
    const a = await seed("rzr-e", "RR00000005", true);
    await req(a.tenantId, "RR00000005");
    const got = await takeRzRelayRequest("RR00000005", a.token);
    expect(got).toEqual({ ip: "182.210.192.200", port: 54321, relayServer: "relay.626.kr" });
    expect(await takeRzRelayRequest("RR00000005", a.token)).toBeNull();
  });

  it("틀린 토큰·남의 ID 로는 못 가져간다", async () => {
    const a = await seed("rzr-f", "RR00000006", true);
    const b = await seed("rzr-g", "RR00000007", true);
    await req(a.tenantId, "RR00000006");
    expect(await takeRzRelayRequest("RR00000006", "wrong-token")).toBeNull();
    expect(await takeRzRelayRequest("RR00000006", b.token)).toBeNull();
    expect(await takeRzRelayRequest("RR00000006", a.token)).not.toBeNull();
  });

  it("60초 지난 요청은 가져가지 않는다", async () => {
    const a = await seed("rzr-h", "RR00000008", true);
    await req(a.tenantId, "RR00000008");
    await testDb()
      .update(rzRelayRequests)
      .set({ createdAt: new Date(Date.now() - 61_000) });
    expect(await takeRzRelayRequest("RR00000008", a.token)).toBeNull();
  });
});
