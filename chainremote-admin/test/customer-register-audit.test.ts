// 거래처 등록이 감사 기록에 남는가 (2026-09-08).
//
// 지워진 것만 남기고 생긴 것은 안 남기니 "큰통치킨하복대점이 언제 들어왔냐"에 답할 자리가
// 없었다. 설치 마법사가 스스로 넣은 것(customer.enroll)과 관리 화면에서 사람이 넣은 것
// (customer.create)을 나눠 적고, 감사 화면의 [등록] 탭이 그 둘만 보여 줘야 한다.
//
// enroll 은 재설치(토큰 회전)에도 같은 라우트를 타므로 **새 행이 생겼을 때만** 남는지도
// 잠근다 — 매 재설치가 "등록"으로 찍히면 탭이 재설치 목록이 된다.

import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { auditLogs, customers, tenants } from "@/lib/schema";
import { hashHeartbeatToken } from "@/lib/heartbeat-token";
import { searchAudit } from "@/lib/data/audit-search";
import { POST as enrollPOST } from "@/app/api/customers/enroll/route";

async function seedTenant(slug: string, enrollKey: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug, enrollSecretHash: hashHeartbeatToken(enrollKey) })
    .returning({ id: tenants.id });
  return t.id;
}

let ipSeq = 200;
const nextIp = () => `10.${(ipSeq++ % 250) + 1}.0.9`;

async function enrollReq(body: Record<string, unknown>) {
  const res = await enrollPOST(
    new Request("http://x/api/customers/enroll", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
      body: JSON.stringify(body),
    }),
  );
  return res.status;
}

async function registerRows(tenantId: string) {
  return testDb()
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "customer.enroll")));
}

describe("거래처 등록 감사 기록", () => {
  it("설치 자동 등록(신규)은 customer.enroll 로 남고, 상호·ID·hostname 이 실린다", async () => {
    const T = await seedTenant("reg-a", "KEY-A");
    expect(
      await enrollReq({ remoteId: "RG00000001", tenantSlug: "reg-a", enrollKey: "KEY-A", name: "큰통치킨", hostname: "POS-1" }),
    ).toBe(200);

    const rows = await registerRows(T);
    expect(rows).toHaveLength(1);
    const [c] = await testDb().select().from(customers).where(eq(customers.remoteId, "RG00000001"));
    expect(rows[0].targetId).toBe(c.id);
    expect(rows[0].userId).toBeNull(); // 사람 계정이 없는 등록 — 대신 IP 가 남는다
    expect(rows[0].ipAddress).toBeTruthy();
    const m = rows[0].metadata as Record<string, unknown>;
    expect(m.via).toBe("enroll");
    expect(m.name).toBe("큰통치킨");
    expect(m.remoteId).toBe("RG00000001");
    expect(m.hostname).toBe("POS-1");
  });

  it("같은 기기의 재설치(토큰 회전)는 등록으로 찍히지 않는다", async () => {
    const T = await seedTenant("reg-b", "KEY-B");
    const body = { remoteId: "RG00000002", tenantSlug: "reg-b", enrollKey: "KEY-B", name: "재설치가게" };
    expect(await enrollReq(body)).toBe(200);
    expect(await enrollReq(body)).toBe(200);
    expect(await enrollReq(body)).toBe(200);
    expect(await registerRows(T)).toHaveLength(1);
  });

  it("[등록] 탭은 create·enroll 만, [변경·삭제] 탭은 그 둘을 뺀다", async () => {
    const T = await seedTenant("reg-c", "KEY-C");
    const db = testDb();
    await db.insert(auditLogs).values([
      { tenantId: T, userId: null, action: "customer.enroll" },
      { tenantId: T, userId: null, action: "customer.create" },
      { tenantId: T, userId: null, action: "customer.delete" },
      { tenantId: T, userId: null, action: "auth.login" },
    ]);
    const reg = await searchAudit({ tenantId: T, period: "all", kind: "register" });
    expect(reg.map((r) => r.action).sort()).toEqual(["customer.create", "customer.enroll"]);
    const chg = await searchAudit({ tenantId: T, period: "all", kind: "change" });
    expect(chg.map((r) => r.action)).toEqual(["customer.delete"]);
    const all = await searchAudit({ tenantId: T, period: "all", kind: "all" });
    expect(all).toHaveLength(4);
  });
});
