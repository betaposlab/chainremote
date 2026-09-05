// 무인접속 비밀번호 (마이그 052) — 거래처 PC 앞에 아무도 없어도 원격이 되게 하는 값.
//
// 이 기능은 **문을 여는 값**이라, 잠글 것이 기능 동작보다 그 문의 경계다:
//
//   ① 무인접속을 안 켠 대리점의 설치본에는 키가 **아예 안 내려간다.**
//      단순히 빈 값을 보내는 게 아니라 키 자체가 없어야 한다 — 에이전트가 "키 없음"을
//      "아무것도 하지 마"로, "빈 값"을 "지워라"로 다르게 읽기 때문이다. 여기가 무너지면
//      무인접속과 무관한 거래처 수십 대의 영구 비밀번호를 10분마다 지우게 된다.
//   ② 되돌릴 수 있어야 한다. 비우면 `""` 가 실제로 내려가 에이전트가 지운다.
//      이게 막히면 한 번 연 문을 원격으로는 닫을 수 없다.
//   ③ 남의 대리점 거래처는 못 건드린다.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { tenants, customers } from "@/lib/schema";
import {
  getUnattendedPassword,
  setUnattendedPassword,
  registerHeartbeatToken,
} from "@/lib/data/customers";
import { POST as heartbeatPOST } from "@/app/api/customers/heartbeat/route";

async function seed(
  slug: string,
  remoteId: string,
  unattendedAgent: boolean,
  password: string | null = null,
) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug, unattendedAgent })
    .returning({ id: tenants.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name: slug, remoteId, unattendedPassword: password })
    .returning({ id: customers.id });
  return { tenantId: t.id, customerId: c.id };
}

async function beat(remoteId: string) {
  const token = await registerHeartbeatToken(remoteId);
  const resp = await heartbeatPOST(
    new Request("http://x/api/customers/heartbeat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.9.9.9",
        "X-ChainRemote-Token": token,
      },
      body: JSON.stringify({ remoteId, version: "1.4.142" }),
    }) as never,
  );
  return (await resp.json()) as Record<string, unknown>;
}

describe("무인접속 비밀번호 — 누구에게 내려가나", () => {
  it("★무인접속을 안 켠 대리점은 null — 응답에 키 자체가 없다", async () => {
    await seed("up-off", "UP0000001", false, "shouldNotLeak");
    expect(await getUnattendedPassword("UP0000001")).toBeNull();

    const body = await beat("UP0000001");
    // toBeUndefined 로는 부족하다 — 키가 있고 값이 undefined 여도 통과한다.
    expect(Object.keys(body)).not.toContain("unattendedPassword");
  });

  it("켠 대리점이고 값이 있으면 그 값이 내려간다", async () => {
    await seed("up-on", "UP0000002", true, "dalin2026");
    expect(await getUnattendedPassword("UP0000002")).toBe("dalin2026");
    expect((await beat("UP0000002")).unattendedPassword).toBe("dalin2026");
  });

  it("★켠 대리점인데 비었으면 빈 문자열이 내려간다 — 이게 되돌리는 길이다", async () => {
    await seed("up-empty", "UP0000003", true, null);
    expect(await getUnattendedPassword("UP0000003")).toBe("");
    const body = await beat("UP0000003");
    expect(Object.keys(body)).toContain("unattendedPassword");
    expect(body.unattendedPassword).toBe("");
  });

  it("모르는 기기면 null — 아직 등록 안 된 설치본이다", async () => {
    expect(await getUnattendedPassword("NOSUCHID1")).toBeNull();
  });
});

describe("무인접속 비밀번호 — 누가 저장할 수 있나", () => {
  it("무인접속을 안 켠 대리점은 저장 자체가 거부된다", async () => {
    const { tenantId, customerId } = await seed("up-deny", "UP0000004", false);
    const r = await setUnattendedPassword(customerId, tenantId, "hello123");
    expect(r.ok).toBe(false);
    const [row] = await testDb()
      .select()
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(row.unattendedPassword).toBeNull();
  });

  it("★남의 대리점 거래처는 못 건드린다", async () => {
    const mine = await seed("up-me", "UP0000005", true);
    const theirs = await seed("up-them", "UP0000006", true);
    // 내 tenantId 로 남의 거래처 id 를 저장 시도.
    const r = await setUnattendedPassword(theirs.customerId, mine.tenantId, "hack1234");
    expect(r.ok).toBe(false);
    expect(await getUnattendedPassword("UP0000006")).toBe("");
  });

  it("저장하면 하트비트에 곧바로 실린다", async () => {
    const { tenantId, customerId } = await seed("up-save", "UP0000007", true);
    const r = await setUnattendedPassword(customerId, tenantId, "chams0547");
    expect(r.ok).toBe(true);
    expect((await beat("UP0000007")).unattendedPassword).toBe("chams0547");
  });

  it("빈 문자열로 저장하면 NULL 이 되고 빈 값이 내려간다 (지우기)", async () => {
    const { tenantId, customerId } = await seed("up-clear", "UP0000008", true, "old12345");
    expect((await setUnattendedPassword(customerId, tenantId, "")).ok).toBe(true);
    const [row] = await testDb()
      .select()
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(row.unattendedPassword).toBeNull();
    expect((await beat("UP0000008")).unattendedPassword).toBe("");
  });
});

// 라우트가 null 과 빈 문자열을 가르는 방식은 **의미가 실린 코드**다. 흔한 정리 리팩터
// (`...(x ? {x} : {})`)로 바꾸면 빈 값이 응답에서 사라져 **지우기가 조용히 죽는다** —
// 한 번 연 문을 원격으로 닫을 수 없게 되고, 그 사실은 닫으려 할 때까지 안 보인다.
// 위 테스트가 동작으로도 잡지만, 왜 그렇게 썼는지를 소스에 못 박아 둔다.
describe("null 과 빈 값을 가르는 코드", () => {
  it("라우트는 falsy 가 아니라 !== null 로 가른다", () => {
    const src = fs.readFileSync("app/api/customers/heartbeat/route.ts", "utf8");
    expect(src).toContain("unattendedPassword !== null");
  });

  it("에이전트도 Option 으로 받는다 — 없는 것과 빈 것을 구분한다", () => {
    const src = fs.readFileSync("../src/chainremote_heartbeat.rs", "utf8");
    expect(src).toContain("unattended_password: Option<String>");
    // 설치본 게이트. 이게 빠지면 무인접속 빌드가 아닌 거래처도 값을 받아 심는다.
    expect(src).toContain("is_unattended_agent()");
  });
});
