import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { customers, tenants } from "@/lib/schema";
import { listCustomers, registerHeartbeatToken } from "@/lib/data/customers";
import { POST as heartbeatPOST } from "@/app/api/customers/heartbeat/route";
import { rzNoReplyMinutes } from "@/app/customers/_status";

// 요청 수신 불가(마이그 055) — 에이전트가 접속 서버 답장을 못 받는 동안 heartbeat 로 알린다.
// 2026-10-01 달인식자재마트: 이 상태가 "온라인"으로 보여 17시간(다른 PC 는 매일) 아무도 몰랐다.

let seq = 0;
async function seed(slug: string, remoteId: string) {
  const db = testDb();
  const [t] = await db.insert(tenants).values({ slug, displayName: slug }).returning({ id: tenants.id });
  await db.insert(customers).values({ tenantId: t.id, name: slug, remoteId });
  const token = await registerHeartbeatToken(remoteId);
  return { tenantId: t.id, token: token! };
}
function hb(body: unknown, token: string) {
  seq += 1;
  return new Request("http://t/api/customers/heartbeat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.77.0.${seq}`,
      "X-ChainRemote-Token": token,
    },
    body: JSON.stringify(body),
  });
}
async function row(remoteId: string) {
  const [r] = await testDb().select().from(customers).where(eq(customers.remoteId, remoteId)).limit(1);
  return r;
}

describe("heartbeat 의 rzNoReplySince", () => {
  it("숫자(epoch 초)면 그 시각을 저장하고, null 이면 지운다", async () => {
    const { token } = await seed("rz-a", "RZ00000001");
    const since = Math.floor(Date.now() / 1000) - 600;
    const r1 = await heartbeatPOST(hb({ remoteId: "RZ00000001", version: "1.4.151", rzNoReplySince: since }, token));
    expect(r1.status).toBe(200);
    const a = await row("RZ00000001");
    expect(a.rzNoreplySince).not.toBeNull();
    expect(Math.floor(new Date(a.rzNoreplySince!).getTime() / 1000)).toBe(since);

    await heartbeatPOST(hb({ remoteId: "RZ00000001", version: "1.4.151", rzNoReplySince: null }, token));
    expect((await row("RZ00000001")).rzNoreplySince).toBeNull();
  });

  it("키가 없으면(옛 에이전트) 있던 값을 건드리지 않는다", async () => {
    const { token } = await seed("rz-b", "RZ00000002");
    const since = Math.floor(Date.now() / 1000) - 120;
    await heartbeatPOST(hb({ remoteId: "RZ00000002", version: "1.4.151", rzNoReplySince: since }, token));
    await heartbeatPOST(hb({ remoteId: "RZ00000002", version: "1.4.151" }, token));
    expect((await row("RZ00000002")).rzNoreplySince).not.toBeNull();
  });

  it("이상한 값(문자열·미래·터무니없는 과거)은 저장하지 않거나 지금으로 누른다", async () => {
    const { token } = await seed("rz-c", "RZ00000003");
    // 문자열 → 미보고 취급.
    await heartbeatPOST(hb({ remoteId: "RZ00000003", version: "1.4.151", rzNoReplySince: "yesterday" }, token));
    expect((await row("RZ00000003")).rzNoreplySince).toBeNull();
    // 시계가 틀린 PC: 미래 → 지금으로.
    const future = Math.floor(Date.now() / 1000) + 86_400;
    await heartbeatPOST(hb({ remoteId: "RZ00000003", version: "1.4.151", rzNoReplySince: future }, token));
    const t1 = new Date((await row("RZ00000003")).rzNoreplySince!).getTime();
    expect(t1).toBeLessThanOrEqual(Date.now());
    expect(Date.now() - t1).toBeLessThan(10_000);
    // 1970년 → 지금으로.
    await heartbeatPOST(hb({ remoteId: "RZ00000003", version: "1.4.151", rzNoReplySince: 5 }, token));
    const t2 = new Date((await row("RZ00000003")).rzNoreplySince!).getTime();
    expect(Date.now() - t2).toBeLessThan(10_000);
  });

  it("본사 앱이 받는 목록에 값과 마지막 보고 시각이 같이 실린다", async () => {
    const { tenantId, token } = await seed("rz-d", "RZ00000004");
    const since = Math.floor(Date.now() / 1000) - 300;
    await heartbeatPOST(hb({ remoteId: "RZ00000004", version: "1.4.151", rzNoReplySince: since }, token));
    const [c] = await listCustomers(tenantId);
    expect(c.rzNoreplySince).not.toBeNull();
    expect(c.lastHeartbeatAt).not.toBeNull();
    // HQ(Rust)가 읽는 키 이름 — 바꾸면 조용히 안 보이게 된다.
    const json = JSON.parse(JSON.stringify(c));
    expect(Object.keys(json)).toContain("rzNoreplySince");
    expect(Object.keys(json)).toContain("lastHeartbeatAt");
    expect(Object.keys(json)).toContain("firewallEnabled");
  });
});

describe("rzNoReplyMinutes — 표시 판정", () => {
  const now = Date.UTC(2026, 9, 2, 3, 0, 0);
  const min = (m: number) => new Date(now - m * 60_000);

  it("값이 있고 보고가 최근이면 경과 분", () => {
    expect(rzNoReplyMinutes(min(42), min(1), now)).toBe(42);
    expect(rzNoReplyMinutes(min(0), min(0), now)).toBe(0);
  });
  it("값이 없으면 null", () => {
    expect(rzNoReplyMinutes(null, min(1), now)).toBeNull();
    expect(rzNoReplyMinutes(min(5), null, now)).toBeNull();
  });
  it("마지막 보고가 15분 넘게 묵었으면 믿지 않는다 — 그 상태로 PC 를 끈 경우", () => {
    expect(rzNoReplyMinutes(min(600), min(14), now)).toBe(600);
    expect(rzNoReplyMinutes(min(600), min(15), now)).toBeNull();
    expect(rzNoReplyMinutes(min(600), min(900), now)).toBeNull();
  });
});
