import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { customers, tenants } from "@/lib/schema";
import { registerHeartbeatToken } from "@/lib/data/customers";
import { POST as heartbeatPOST } from "@/app/api/customers/heartbeat/route";
import { sanitizeInfectSigns, infectLabels } from "@/lib/infect-signs";

// 알려진 감염 흔적(마이그 061). 재고 윈7 포스 4대가 같은 백도어에 걸려 있었고(2026-10-20), 같은 방식으로
// 세팅해 매장에 나간 포스를 가려내려고 에이전트가 흔적을 보낸다. 깨끗해지면 빈 문자열로 옛 경고를 지운다.

let seq = 0;
async function seed(slug: string, remoteId: string) {
  const db = testDb();
  const [t] = await db.insert(tenants).values({ slug, displayName: slug }).returning({ id: tenants.id });
  await db.insert(customers).values({ tenantId: t.id, name: slug, remoteId });
  return (await registerHeartbeatToken(remoteId))!;
}
function hb(body: unknown, token: string) {
  seq += 1;
  return new Request("http://t/api/customers/heartbeat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.81.0.${seq}`,
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

describe("sanitizeInfectSigns / infectLabels", () => {
  it("아는 코드만, 고정 순서로, 중복 없이 남긴다", () => {
    expect(sanitizeInfectSigns("selfappend, LAUNCH,launch,bogus,<b>")).toBe("launch,selfappend");
    expect(sanitizeInfectSigns("")).toBe("");
  });
  it("설명은 코드마다 한 줄", () => {
    expect(infectLabels("launch,runkey")).toHaveLength(2);
    expect(infectLabels("")).toEqual([]);
    expect(infectLabels(null)).toEqual([]);
  });
});

describe("heartbeat 의 infectSigns / infectCheckedAt", () => {
  it("흔적을 저장하고, 빈 문자열이 오면 지운다", async () => {
    const token = await seed("inf-a", "IN00000001");
    const at = nowSec() - 30;
    const res = await heartbeatPOST(
      hb({ remoteId: "IN00000001", version: "1.4.159", infectCheckedAt: at, infectSigns: "launch,runkey,selfappend" }, token),
    );
    expect(res.status).toBe(200);
    let r = await row("IN00000001");
    expect(r.infectSigns).toBe("launch,runkey,selfappend");
    expect(Math.floor(new Date(r.infectCheckedAt!).getTime() / 1000)).toBe(at);

    // 재설치 뒤 깨끗해지면 에이전트가 빈 문자열을 보낸다.
    await heartbeatPOST(hb({ remoteId: "IN00000001", version: "1.4.159", infectCheckedAt: nowSec(), infectSigns: "" }, token));
    r = await row("IN00000001");
    expect(r.infectSigns).toBe("");
  });

  it("키가 없으면(옛 에이전트·점검 전) 손대지 않는다", async () => {
    const token = await seed("inf-b", "IN00000002");
    await heartbeatPOST(hb({ remoteId: "IN00000002", version: "1.4.159", infectCheckedAt: nowSec(), infectSigns: "wdext" }, token));
    await heartbeatPOST(hb({ remoteId: "IN00000002", version: "1.4.158" }, token));
    const r = await row("IN00000002");
    expect(r.infectSigns).toBe("wdext");
  });

  it("모르는 코드는 버리고, 시각이 엉뚱하면 서버 시각으로 둔다", async () => {
    const token = await seed("inf-c", "IN00000003");
    await heartbeatPOST(hb({ remoteId: "IN00000003", version: "1.4.159", infectCheckedAt: 99999999999, infectSigns: "mscaps,evil" }, token));
    const r = await row("IN00000003");
    expect(r.infectSigns).toBe("mscaps");
    expect(Math.abs(new Date(r.infectCheckedAt!).getTime() - Date.now())).toBeLessThan(60_000);
  });
});
