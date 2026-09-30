// 같은 상호 + 죽은 옛 기기 → 증거 없이는 합치지 않는다 (2026-09-30).
//
// 종전엔 상호가 같고 옛 기기가 15분 넘게 조용하면 "포스 교체"로 합쳤다. 다른 동네에 이름이
// 같은 매장이 있고 그 집 포스가 마침 꺼져 있으면(밤이면 늘 그렇다) 신규 매장이 남의 행에
// 붙었다. 합치는 조건은 이제 둘뿐: ①설치자가 "같은 매장 — 교체"라고 답함 ②같은 공인 IP.
// 둘 다 아니면 새 행 + 마스터 결정 알림. 알림의 [교체로 합치기]가 사후 합치기다.

import { describe, it, expect } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { enrollCustomer } from "@/lib/data/customers";
import { applyAlertMergeReplacement } from "@/lib/data/alerts";
import { hashHeartbeatToken } from "@/lib/heartbeat-token";
import { customerAlerts, customers, supportSessions, tenants, userFavorites, users } from "@/lib/schema";
import { POST as enrollCheckPOST } from "@/app/api/customers/enroll-check/route";

async function seedTenant(slug: string, enrollKey?: string) {
  const [t] = await testDb()
    .insert(tenants)
    .values({
      slug,
      displayName: slug,
      ...(enrollKey ? { enrollSecretHash: hashHeartbeatToken(enrollKey) } : {}),
    })
    .returning({ id: tenants.id });
  return t.id;
}
async function seedUser(tenantId: string, email: string) {
  const [u] = await testDb()
    .insert(users)
    .values({ tenantId, email, passwordHash: "x", displayName: email })
    .returning({ id: users.id });
  return u.id;
}
const DEAD = () => new Date(Date.now() - 60 * 60_000);
async function seedCustomer(tenantId: string, name: string, remoteId: string, lastIp: string | null) {
  const [c] = await testDb()
    .insert(customers)
    .values({ tenantId, name, remoteId, lastHeartbeatAt: DEAD(), lastIp, enrollStatus: "active" })
    .returning({ id: customers.id });
  return c.id;
}
async function rowsOf(tenantId: string) {
  return testDb().select().from(customers).where(eq(customers.tenantId, tenantId));
}
async function openAlerts(tenantId: string, type: string) {
  return testDb()
    .select()
    .from(customerAlerts)
    .where(and(eq(customerAlerts.tenantId, tenantId), eq(customerAlerts.type, type), isNull(customerAlerts.resolvedAt)));
}

describe("같은 상호 + 죽은 옛 기기", () => {
  it("같은 공인 IP 면 교체로 합친다 (같은 가게의 새 포스)", async () => {
    const T = await seedTenant("sn-ip");
    const old = await seedCustomer(T, "중앙리", "OLD000001", "1.2.3.4");
    await enrollCustomer({ remoteId: "NEW000001", name: "중앙리", ip: "1.2.3.4" }, { tenantId: T });
    const [r] = await rowsOf(T);
    expect(r.id).toBe(old);
    expect(r.remoteId).toBe("NEW000001");
    const [log] = await testDb().select().from(customerAlerts).where(eq(customerAlerts.type, "device_replaced"));
    expect(JSON.parse(log.detail as string).reason).toBe("same_ip");
  });

  it("IP 가 다르면 합치지 않는다 — 새 행 + 마스터 결정 알림 (다른 동네 동명 매장 보호)", async () => {
    const T = await seedTenant("sn-diffip");
    const old = await seedCustomer(T, "중앙리", "OLD000002", "1.2.3.4");
    await enrollCustomer({ remoteId: "NEW000002", name: "중앙리", ip: "9.9.9.9" }, { tenantId: T });
    const rows = await rowsOf(T);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === old)!.remoteId).toBe("OLD000002"); // 옛 행 그대로
    const alerts = await openAlerts(T, "same_name_dead_device");
    expect(alerts).toHaveLength(1);
    const d = JSON.parse(alerts[0].detail as string);
    expect(d.oldCustomerId).toBe(old);
    expect(d.oldLastIp).toBe("1.2.3.4");
    expect(d.newIp).toBe("9.9.9.9");
  });

  it("옛 기기의 IP 를 모르면(옛 에이전트) 합치지 않는다", async () => {
    const T = await seedTenant("sn-noip");
    await seedCustomer(T, "중앙리", "OLD000003", null);
    await enrollCustomer({ remoteId: "NEW000003", name: "중앙리", ip: "1.2.3.4" }, { tenantId: T });
    expect(await rowsOf(T)).toHaveLength(2);
    expect(await openAlerts(T, "same_name_dead_device")).toHaveLength(1);
  });

  it("설치자가 '같은 매장 — 교체'라고 답하면 IP 가 달라도 합친다", async () => {
    const T = await seedTenant("sn-human");
    const old = await seedCustomer(T, "중앙리", "OLD000004", "1.2.3.4");
    await enrollCustomer(
      { remoteId: "NEW000004", name: "중앙리", ip: "9.9.9.9", replaceExisting: true },
      { tenantId: T },
    );
    const [r] = await rowsOf(T);
    expect(r.id).toBe(old);
    expect(r.remoteId).toBe("NEW000004");
    const [log] = await testDb().select().from(customerAlerts).where(eq(customerAlerts.type, "device_replaced"));
    expect(JSON.parse(log.detail as string).reason).toBe("human");
  });

  it("설치자가 '다른 매장'이라고 답하면 같은 IP 여도 합치지 않고, 결정 알림도 안 띄운다", async () => {
    const T = await seedTenant("sn-newsite");
    await seedCustomer(T, "중앙리", "OLD000005", "1.2.3.4");
    await enrollCustomer(
      { remoteId: "NEW000005", name: "중앙리", ip: "1.2.3.4", newSite: true },
      { tenantId: T },
    );
    expect(await rowsOf(T)).toHaveLength(2);
    expect(await openAlerts(T, "same_name_dead_device")).toHaveLength(0);
  });

  it("[교체로 합치기]: 새 행의 기기·토큰·이력·즐겨찾기를 옛 행으로 옮기고 새 행을 지운다", async () => {
    const T = await seedTenant("sn-merge");
    const uid = await seedUser(T, "chang@sn.merge");
    const old = await seedCustomer(T, "중앙리", "OLD000006", "1.2.3.4");
    const r = await enrollCustomer({ remoteId: "NEW000006", name: "중앙리", ip: "9.9.9.9" }, { tenantId: T });
    expect(r).not.toBe("cross_tenant");
    const fresh = (await rowsOf(T)).find((x) => x.id !== old)!;
    // 그 사이 새 행에 붙은 것들
    await testDb().insert(userFavorites).values({ userId: uid, remoteId: "NEW000006", customerId: fresh.id, tenantId: T });
    await testDb().insert(supportSessions).values({ tenantId: T, customerId: fresh.id, operatorId: uid, remoteId: "NEW000006" });
    const [alert] = await openAlerts(T, "same_name_dead_device");

    expect(await applyAlertMergeReplacement(alert.id, T)).toBe(true);

    const rows = await rowsOf(T);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(old);
    expect(rows[0].remoteId).toBe("NEW000006");
    expect(rows[0].heartbeatToken).toBe(fresh.heartbeatToken); // 토큰 승계 — 재등록 없이 계속
    const [fav] = await testDb().select().from(userFavorites).where(eq(userFavorites.userId, uid));
    expect(fav.customerId).toBe(old);
    const [ses] = await testDb().select().from(supportSessions).where(eq(supportSessions.tenantId, T));
    expect(ses.customerId).toBe(old);
    expect(await openAlerts(T, "same_name_dead_device")).toHaveLength(0);
  });
});

describe("설치 화면의 상호 조회 (enroll-check)", () => {
  async function post(body: unknown, ip = "10.0.0.1") {
    const res = await enrollCheckPOST(
      new Request("http://x/api/customers/enroll-check", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: await res.json() };
  }
  it("같은 대리점의 동명 거래처만, ID·마지막 접속·생존만 돌려준다", async () => {
    const T = await seedTenant("ec-a", "KEY-A");
    const U = await seedTenant("ec-b", "KEY-B");
    await seedCustomer(T, "중앙리", "OLD000007", "1.2.3.4");
    await seedCustomer(U, "중앙리", "OLD000008", "5.5.5.5"); // 남의 대리점
    const r = await post({ tenantSlug: "ec-a", enrollKey: "KEY-A", name: "중앙 리" });
    expect(r.status).toBe(200);
    expect(r.json.matches).toHaveLength(1);
    expect(r.json.matches[0]).toMatchObject({ remoteId: "OLD000007", alive: false });
    expect(Object.keys(r.json.matches[0]).sort()).toEqual(["alive", "lastHeartbeatAt", "remoteId"]);
  });
  it("키가 틀리면 403, 이름이 비면 빈 목록", async () => {
    await seedTenant("ec-c", "KEY-C");
    expect((await post({ tenantSlug: "ec-c", enrollKey: "WRONG", name: "x" }, "10.0.0.2")).status).toBe(403);
    expect((await post({ tenantSlug: "ec-c", enrollKey: "KEY-C", name: "" }, "10.0.0.3")).json.matches).toEqual([]);
  });
});
