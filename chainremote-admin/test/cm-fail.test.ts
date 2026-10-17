import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { customers, tenants } from "@/lib/schema";
import { registerHeartbeatToken } from "@/lib/data/customers";
import { POST as heartbeatPOST } from "@/app/api/customers/heartbeat/route";
import { cmFailInfo } from "@/app/customers/_status";

// 수락 카드를 못 띄운 기록(마이그 059). 거래처 쪽에선 아무 일도 없어 보이는 고장이라,
// 아무도 접속하지 않아도 거래처 표에 드러나야 한다(2026-10-17 세종싱싱활어회배달, os error 740).

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
      "x-forwarded-for": `10.79.0.${seq}`,
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

describe("heartbeat 의 cmFailAt / cmFailCode", () => {
  it("숫자면 시각과 코드를 저장하고, null 이 오면 둘 다 지운다", async () => {
    const token = await seed("cmf-a", "CF00000001");
    const at = nowSec() - 300;
    expect((await heartbeatPOST(hb({ remoteId: "CF00000001", version: "1.4.156", cmFailAt: at, cmFailCode: "740" }, token))).status).toBe(200);
    let r = await row("CF00000001");
    expect(Math.floor(new Date(r.cmFailAt!).getTime() / 1000)).toBe(at);
    expect(r.cmFailCode).toBe("740");

    // 카드가 다시 정상으로 뜨면 에이전트가 null 을 보낸다.
    await heartbeatPOST(hb({ remoteId: "CF00000001", version: "1.4.156", cmFailAt: null }, token));
    r = await row("CF00000001");
    expect(r.cmFailAt).toBeNull();
    expect(r.cmFailCode).toBeNull();
  });

  it("키가 없으면(옛 에이전트) 손대지 않는다", async () => {
    const token = await seed("cmf-b", "CF00000002");
    await heartbeatPOST(hb({ remoteId: "CF00000002", version: "1.4.156", cmFailAt: nowSec(), cmFailCode: "cm" }, token));
    await heartbeatPOST(hb({ remoteId: "CF00000002", version: "1.4.153" }, token));
    expect((await row("CF00000002")).cmFailAt).not.toBeNull();
  });

  it("코드는 영숫자 16자로 자르고, 비면 'cm' — 시계가 미래면 지금으로 눌러 둔다", async () => {
    const token = await seed("cmf-c", "CF00000003");
    await heartbeatPOST(
      hb({ remoteId: "CF00000003", version: "1.4.156", cmFailAt: nowSec() + 86400, cmFailCode: "<script>1234567890123456789" }, token),
    );
    const r = await row("CF00000003");
    expect(r.cmFailCode).toBe("script1234567890");
    expect(new Date(r.cmFailAt!).getTime()).toBeLessThanOrEqual(Date.now());

    await heartbeatPOST(hb({ remoteId: "CF00000003", version: "1.4.156", cmFailAt: nowSec(), cmFailCode: "!!!" }, token));
    expect((await row("CF00000003")).cmFailCode).toBe("cm");
  });
});

describe("cmFailInfo — 거래처 표의 문구", () => {
  const now = Date.parse("2026-10-17T08:00:00Z");
  it("기록이 없거나 30일 넘게 묵었으면 표시하지 않는다", () => {
    expect(cmFailInfo(null, null, now)).toBeNull();
    expect(cmFailInfo(new Date(now - 31 * 24 * 3600_000), "740", now)).toBeNull();
  });
  it("740 은 권한 설정이라고 말하고, 그 밖은 일반 문구 — 둘 다 임시 원격을 안내한다", () => {
    const a = cmFailInfo(new Date(now - 60_000), "740", now)!;
    expect(a.label).toContain("수락 창 실패");
    expect(a.detail).toContain("관리자 권한");
    expect(a.detail).toContain("626.kr");
    const b = cmFailInfo(new Date(now - 60_000), "cm", now)!;
    expect(b.detail).not.toContain("관리자 권한");
    expect(cmFailInfo(new Date(now - 60_000), "5", now)!.detail).toContain("오류 5");
  });
});
