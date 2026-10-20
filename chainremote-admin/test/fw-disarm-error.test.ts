import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { customers, tenants } from "@/lib/schema";
import { registerHeartbeatToken } from "@/lib/data/customers";
import { POST as heartbeatPOST } from "@/app/api/customers/heartbeat/route";
import { firewallErrorText } from "@/app/customers/_firewall-chip";

// 방화벽 끄기 실패 이유(마이그 060). 테스트1 은 끄는 명령이 10분 멈췄고 샵단란주점은 한 번도 못
// 껐는데, 패널·HQ 엔 "해제 대기"만 떠 아무도 몰랐다(2026-10-19~20). 에이전트가 이유를 보내면 남기고,
// 끄는 데 성공하면 null 로 지운다.

let seq = 0;
async function seed(slug: string, remoteId: string) {
  const db = testDb();
  const [t] = await db.insert(tenants).values({ slug, displayName: slug }).returning({ id: tenants.id });
  await db.insert(customers).values({ tenantId: t.id, name: slug, remoteId, firewallControl: true });
  return (await registerHeartbeatToken(remoteId))!;
}
function hb(body: unknown, token: string) {
  seq += 1;
  return new Request("http://t/api/customers/heartbeat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.80.0.${seq}`,
      "X-ChainRemote-Token": token,
    },
    body: JSON.stringify(body),
  });
}
async function row(remoteId: string) {
  const [r] = await testDb().select().from(customers).where(eq(customers.remoteId, remoteId)).limit(1);
  return r;
}
const nowSec = () => Math.floor(Date.now() / 1000);

describe("heartbeat 의 firewallDisarmError / firewallDisarmErrorAt", () => {
  it("실패 이유를 저장하고, null 이 오면 둘 다 지운다", async () => {
    const token = await seed("fwe-a", "FE00000001");
    const at = nowSec() - 60;
    const res = await heartbeatPOST(
      hb({ remoteId: "FE00000001", version: "1.4.157", firewallEnabled: true, firewallDisarmErrorAt: at, firewallDisarmError: "timeout" }, token),
    );
    expect(res.status).toBe(200);
    let r = await row("FE00000001");
    expect(r.firewallDisarmError).toBe("timeout");
    expect(Math.floor(new Date(r.firewallDisarmErrorAt!).getTime() / 1000)).toBe(at);
    expect(r.firewallEnabled).toBe(true);

    // 끄는 데 성공하면 에이전트가 null 을 보낸다.
    await heartbeatPOST(hb({ remoteId: "FE00000001", version: "1.4.157", firewallEnabled: false, firewallDisarmErrorAt: null }, token));
    r = await row("FE00000001");
    expect(r.firewallDisarmError).toBeNull();
    expect(r.firewallDisarmErrorAt).toBeNull();
  });

  it("키가 없으면(옛 에이전트) 손대지 않는다", async () => {
    const token = await seed("fwe-b", "FE00000002");
    await heartbeatPOST(hb({ remoteId: "FE00000002", version: "1.4.157", firewallDisarmErrorAt: nowSec(), firewallDisarmError: "exit1" }, token));
    await heartbeatPOST(hb({ remoteId: "FE00000002", version: "1.4.156", firewallEnabled: true }, token));
    expect((await row("FE00000002")).firewallDisarmError).toBe("exit1");
  });

  it("코드는 영숫자 16자로 자르고, 비면 'fw' — 시계가 미래면 지금으로 눌러 둔다", async () => {
    const token = await seed("fwe-c", "FE00000003");
    await heartbeatPOST(
      hb({ remoteId: "FE00000003", version: "1.4.157", firewallDisarmErrorAt: nowSec() + 86400, firewallDisarmError: "<b>exitc0000005-xyz-long" }, token),
    );
    const r = await row("FE00000003");
    expect(r.firewallDisarmError).toBe("bexitc0000005xyz");
    expect(new Date(r.firewallDisarmErrorAt!).getTime()).toBeLessThanOrEqual(Date.now());

    await heartbeatPOST(hb({ remoteId: "FE00000003", version: "1.4.157", firewallDisarmErrorAt: nowSec(), firewallDisarmError: "!!" }, token));
    expect((await row("FE00000003")).firewallDisarmError).toBe("fw");
  });
});

describe("firewallErrorText — 패널·HQ 공통 문구", () => {
  it("코드를 사람 말로 바꾼다", () => {
    expect(firewallErrorText("timeout")).toContain("30초");
    expect(firewallErrorText("exit1")).toBe("끄는 명령이 실패함(코드 1)");
    expect(firewallErrorText("exit")).toBe("끄는 명령이 실패함");
    expect(firewallErrorText("spawn")).toContain("실행하지 못함");
    expect(firewallErrorText("zzz")).toContain("zzz");
  });
});
