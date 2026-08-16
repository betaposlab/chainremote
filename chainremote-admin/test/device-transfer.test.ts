import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { moveDeviceToNewCustomer } from "@/lib/data/alerts";
import { customers, supportSessions, tenants, userFavorites, users } from "@/lib/schema";
import { hashHeartbeatToken } from "@/lib/heartbeat-token";

// 기기 이관 — 폐업 매장 포스를 수거해 다른 가맹점에 재사용하는 흐름(2026-08-16 Chang).
//   포맷 후 재설치하면 서버가 알림으로 잡아 주지만, ChainRemote 를 안 지우고 포스 앱만
//   갈아끼우면 재등록이 없어 알림도 안 뜬다 — 그때 사람이 직접 부르는 경로다.

async function seed() {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug: "mv", displayName: "mv" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({ tenantId: t.id, email: "o@x", displayName: "o", passwordHash: "x", role: "owner" })
    .returning({ id: users.id });
  const [c] = await db
    .insert(customers)
    .values({
      tenantId: t.id,
      name: "폐업한 매장",
      remoteId: "211191101",
      heartbeatToken: hashHeartbeatToken("tok"),
    })
    .returning({ id: customers.id });
  return { tenantId: t.id, userId: u.id, customerId: c.id };
}

describe("기기 이관", () => {
  it("기기는 새 거래처로 가고, 옛 매장 행과 지원 이력은 그대로 남는다", async () => {
    const s = await seed();
    const db = testDb();
    // 옛 매장에서 A/S 를 한 번 했다.
    await db.insert(supportSessions).values({
      tenantId: s.tenantId,
      customerId: s.customerId,
      operatorId: s.userId,
      remoteId: "211191101",
      endedAt: new Date(),
      description: "폐업 전 프린터 수리",
    });

    const r = await moveDeviceToNewCustomer(s.customerId, "새로 연 가게", s.tenantId);
    expect(r.ok).toBe(true);

    const [oldRow] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, s.customerId));
    expect(oldRow.name).toBe("폐업한 매장"); // 행 자체는 남는다
    expect(oldRow.remoteId).toBeNull(); // 기기만 떨어졌다

    const [newRow] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, r.newCustomerId!));
    expect(newRow.name).toBe("새로 연 가게");
    expect(newRow.remoteId).toBe("211191101");
    // ★토큰 승계 — 거래처 PC 를 다시 설치할 필요가 없다.
    expect(newRow.heartbeatToken).toBe(hashHeartbeatToken("tok"));

    // 옛 매장 이력은 옛 매장에 남아야 한다(섞이면 "예전에 뭐 했지"를 못 본다).
    const sessions = await db
      .select()
      .from(supportSessions)
      .where(eq(supportSessions.customerId, s.customerId));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].description).toContain("프린터");
  });

  it("즐겨찾기는 기기를 따라 새 거래처로 옮겨간다", async () => {
    const s = await seed();
    await testDb().insert(userFavorites).values({
      tenantId: s.tenantId,
      userId: s.userId,
      customerId: s.customerId,
      remoteId: "211191101",
    });
    const r = await moveDeviceToNewCustomer(s.customerId, "새 가게", s.tenantId);
    const [fav] = await testDb()
      .select()
      .from(userFavorites)
      .where(eq(userFavorites.remoteId, "211191101"));
    expect(fav.customerId).toBe(r.newCustomerId);
  });

  it("같은 상호로는 못 옮긴다 — 그건 이관이 아니라 아무것도 아니다", async () => {
    const s = await seed();
    const r = await moveDeviceToNewCustomer(s.customerId, "폐업한 매장", s.tenantId);
    expect(r.ok).toBe(false);
  });

  it("기기가 없는 거래처는 옮길 게 없다", async () => {
    const s = await seed();
    await testDb()
      .update(customers)
      .set({ remoteId: null })
      .where(eq(customers.id, s.customerId));
    const r = await moveDeviceToNewCustomer(s.customerId, "새 가게", s.tenantId);
    expect(r.ok).toBe(false);
  });

  it("남의 대리점 거래처는 못 건드린다", async () => {
    const s = await seed();
    const r = await moveDeviceToNewCustomer(
      s.customerId,
      "새 가게",
      "00000000-0000-4000-8000-00000000dead",
    );
    expect(r.ok).toBe(false);
  });
});
