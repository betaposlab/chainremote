import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { tenants, customers } from "@/lib/schema";
import { updateCustomer, registerHeartbeatTokenFirstIssue } from "@/lib/data/customers";

// 2026-10-01 삼성공판장: 에이전트 ID 가 바뀐 기기(지문 못 읽고 종료 → ID 재생성)는 옛 토큰을
// 버리고 register-heartbeat-token 으로 새 토큰을 받으려 든다. 그 경로는 토큰 없는 행에만
// 발급하므로, 패널에서 원격 ID 만 고치고 토큰을 두면 영원히 409 다.

async function seed() {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug: "rid-change", displayName: "rid-change" })
    .returning({ id: tenants.id });
  const [c] = await db
    .insert(customers)
    .values({
      tenantId: t.id,
      name: "삼성공판장",
      remoteId: "23206458",
      heartbeatToken: "old-token-hash",
    })
    .returning({ id: customers.id });
  return { tenantId: t.id, customerId: c.id };
}

const base = {
  name: "삼성공판장",
  contactName: null,
  phone: null,
  address: null,
  accessPassword: null,
  notes: null,
};

describe("원격 ID 를 손으로 바꾸면 하트비트 토큰이 비워진다", () => {
  it("ID 변경 → 토큰 null → 새 ID 로 첫 발급이 통한다", async () => {
    const db = testDb();
    const { tenantId, customerId } = await seed();
    const row = await updateCustomer(
      customerId,
      { ...base, remoteId: "BD77537281" },
      { tenantId },
    );
    expect(row?.remoteId).toBe("BD77537281");
    const [after] = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(after.heartbeatToken).toBeNull();
    // 에이전트가 새 ID 로 register 하면 토큰이 나와야 한다(종전엔 409 영구 고착).
    const token = await registerHeartbeatTokenFirstIssue("BD77537281");
    expect(token).toBeTruthy();
  });

  it("ID 가 그대로면(상호만 수정) 토큰은 건드리지 않는다", async () => {
    const db = testDb();
    const { tenantId, customerId } = await seed();
    await updateCustomer(
      customerId,
      { ...base, name: "삼성공판장 본점", remoteId: "23206458" },
      { tenantId },
    );
    const [after] = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(after.name).toBe("삼성공판장 본점");
    expect(after.heartbeatToken).toBe("old-token-hash");
  });
});
