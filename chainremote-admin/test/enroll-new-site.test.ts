import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { enrollCustomer } from "@/lib/data/customers";
import { customers, supportSessions, tenants, userFavorites, users } from "@/lib/schema";

// 설치 화면의 "다른 매장에 설치합니다"(newSite) — 2026-08-16 Chang 아이디어의 서버 몫.
//   인스톨러 UI 는 다음 사이클에 붙는다. 서버만 먼저 받아 두고, 옛 인스톨러(플래그 미전송)는
//   지금까지와 100% 같게 동작해야 한다.
//
// ★기기 ID 는 절대 안 바뀐다. 바뀌는 건 "어느 거래처 행에 붙어 있나" 뿐이다.

const RID = "211191101";

async function seed(oldName = "폐업한 매장") {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug: "ns", displayName: "ns" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({ tenantId: t.id, email: "o@x", displayName: "o", passwordHash: "x", role: "owner" })
    .returning({ id: users.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name: oldName, remoteId: RID, enrollStatus: "active" })
    .returning({ id: customers.id });
  return { tenantId: t.id, userId: u.id, oldId: c.id };
}

describe("설치 시 '다른 매장' 선택", () => {
  it("새 거래처가 생기고 기기가 옮겨간다 — ID 는 그대로", async () => {
    const s = await seed();
    const r = await enrollCustomer(
      { remoteId: RID, name: "낭성정육 2호점", newSite: true },
      { tenantId: s.tenantId },
    );
    expect(r).not.toBe("cross_tenant");

    const rows = await testDb().select().from(customers);
    expect(rows).toHaveLength(2);

    const oldRow = rows.find((x) => x.id === s.oldId)!;
    expect(oldRow.name).toBe("폐업한 매장"); // 옛 행은 남는다
    expect(oldRow.remoteId).toBeNull(); // 기기만 떨어졌다

    const newRow = rows.find((x) => x.id !== s.oldId)!;
    expect(newRow.name).toBe("낭성정육 2호점");
    expect(newRow.remoteId).toBe(RID); // ★같은 ID 그대로
    expect(newRow.enrollStatus).toBe("pending"); // 확정은 마스터 몫
  });

  it("옛 매장의 지원 이력은 옛 매장에 남는다(섞이지 않는다)", async () => {
    const s = await seed();
    await testDb().insert(supportSessions).values({
      tenantId: s.tenantId,
      customerId: s.oldId,
      operatorId: s.userId,
      remoteId: RID,
      endedAt: new Date(),
      description: "폐업 전 프린터 수리",
    });
    await enrollCustomer(
      { remoteId: RID, name: "새 가게", newSite: true },
      { tenantId: s.tenantId },
    );
    const sess = await testDb()
      .select()
      .from(supportSessions)
      .where(eq(supportSessions.customerId, s.oldId));
    expect(sess).toHaveLength(1);
  });

  it("즐겨찾기는 기기를 따라 새 거래처로", async () => {
    const s = await seed();
    await testDb().insert(userFavorites).values({
      tenantId: s.tenantId,
      userId: s.userId,
      customerId: s.oldId,
      remoteId: RID,
    });
    await enrollCustomer(
      { remoteId: RID, name: "새 가게", newSite: true },
      { tenantId: s.tenantId },
    );
    const [fav] = await testDb()
      .select()
      .from(userFavorites)
      .where(eq(userFavorites.remoteId, RID));
    expect(fav.customerId).not.toBe(s.oldId);
  });

  it("'다른 매장'인데 지금과 같은 상호면 재설치로 본다 — 행이 안 늘어난다", async () => {
    const s = await seed("태조산 메인");
    await enrollCustomer(
      { remoteId: RID, name: "태조산 메인", newSite: true },
      { tenantId: s.tenantId },
    );
    expect(await testDb().select().from(customers)).toHaveLength(1);
  });

  it("상호를 안 넣으면 판단 근거가 없으니 평소 흐름", async () => {
    const s = await seed();
    await enrollCustomer({ remoteId: RID, newSite: true }, { tenantId: s.tenantId });
    const rows = await testDb().select().from(customers);
    expect(rows).toHaveLength(1);
    expect(rows[0].remoteId).toBe(RID);
  });

  it("★옛 인스톨러(플래그 미전송)는 지금까지와 똑같이 동작한다 — 알림만 뜨고 아무것도 안 바뀜", async () => {
    const s = await seed();
    await enrollCustomer(
      { remoteId: RID, name: "생판 새 이름" },
      { tenantId: s.tenantId },
    );
    const rows = await testDb().select().from(customers);
    expect(rows).toHaveLength(1); // 새 행이 안 생긴다
    expect(rows[0].name).toBe("폐업한 매장"); // 이름도 그대로
  });
});
