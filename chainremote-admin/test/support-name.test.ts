// 거래처 수락창에 뜰 대리점 상호 (마이그 029).
//
// 폴백이 이 기능의 전부다 — 값을 안 채운 대리점이 대다수이고, 폴백이 조용히 깨지면
// 카드에 이름이 아예 안 뜬다(그래도 화면은 멀쩡해 보여서 한참 모른다). 그래서 채운
// 경우/안 채운 경우/공백만 넣은 경우를 다 잠가둔다.

import { describe, it, expect } from "vitest";
import { testDb } from "./helpers/db";
import { getSupportName, registerHeartbeatToken } from "@/lib/data/customers";
import { tenants, customers } from "@/lib/schema";
import { POST as heartbeatPOST } from "@/app/api/customers/heartbeat/route";

async function makeTenant(
  slug: string,
  displayName: string,
  supportDisplayName?: string | null,
): Promise<string> {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName, supportDisplayName: supportDisplayName ?? null })
    .returning({ id: tenants.id });
  return t.id;
}

async function makeCustomer(tenantId: string, remoteId: string) {
  const db = testDb();
  await db.insert(customers).values({ tenantId, name: remoteId, remoteId });
}

describe("대리점 상호 (수락창 표시용)", () => {
  it("값을 채웠으면 그 상호가 나온다", async () => {
    const t = await makeTenant("sn-a", "베타포스랩", "대전문성텔레콤");
    await makeCustomer(t, "SN0000001");
    expect(await getSupportName("SN0000001")).toBe("대전문성텔레콤");
  });

  it("비어 있으면 회사명으로 폴백한다 — 대다수 대리점이 이 경로", async () => {
    const t = await makeTenant("sn-b", "탑아이엔티", null);
    await makeCustomer(t, "SN0000002");
    expect(await getSupportName("SN0000002")).toBe("탑아이엔티");
  });

  it("공백만 넣어도 폴백한다 (실수로 스페이스만 저장한 경우)", async () => {
    const t = await makeTenant("sn-c", "무성텔레콤", "   ");
    await makeCustomer(t, "SN0000003");
    expect(await getSupportName("SN0000003")).toBe("무성텔레콤");
  });

  it("모르는 거래처면 null — 카드는 '본사'로 폴백한다", async () => {
    expect(await getSupportName("NOSUCHID9")).toBeNull();
  });

  it("heartbeat 응답에 supportName 이 실린다", async () => {
    const t = await makeTenant("sn-d", "베타포스랩", "대전문성텔레콤");
    await makeCustomer(t, "SN0000004");
    // registerHeartbeatToken 은 customer id 가 아니라 remoteId 를 받는다.
    const token = await registerHeartbeatToken("SN0000004");

    const resp = await heartbeatPOST(
      new Request("http://x/api/customers/heartbeat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.9.9.4",
          "X-ChainRemote-Token": token,
        },
        body: JSON.stringify({ remoteId: "SN0000004", version: "1.4.87" }),
      }) as never,
    );
    const json = await resp.json();
    expect(json.supportName).toBe("대전문성텔레콤");
  });
});
