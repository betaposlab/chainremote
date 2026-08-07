// 감사 로그 — 되돌릴 수 없거나 권한이 걸린 행위가 실제로 기록되는가.
//
// 이 기능의 고약한 점은 실패가 안 보인다는 것이다. 안 남아도 화면은 멀쩡하고, 필요해지는
// 순간(= 거래처가 사라졌는데 아무도 안 지웠다고 할 때)은 이미 늦었다. 실제로 audit_logs
// 테이블은 만들어진 뒤 아무도 안 써서 0건이었고, 아무도 몰랐다.
//
// 그래서 "남는다"만이 아니라 **비밀값이 안 남는다**와 **일상 동작은 안 남는다**도 같이
// 잠근다. 전자는 사고, 후자는 노이즈에 묻혀 못 찾게 되는 문제다.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { tenants, customers, auditLogs } from "@/lib/schema";
import { writeAudit } from "@/lib/data/audit";
import { deleteCustomer } from "@/lib/data/customers";

async function makeTenant(slug: string): Promise<string> {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  return t.id;
}

async function makeCustomer(tenantId: string, name: string, remoteId: string) {
  const db = testDb();
  const [c] = await db
    .insert(customers)
    .values({ tenantId, name, remoteId })
    .returning({ id: customers.id });
  return c.id;
}

// 소스 전수 검사. "누가" 없는 감사로그는 반쪽이라 기록 지점이 늘어날 때마다 빠뜨리기 쉽다
// (실제로 무인접속 토글에서 한 번 빠졌고, 라이브에서 실행자가 null 로 찍혀서야 알았다).
describe("감사 로그 호출부 — 전수", () => {
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...sources(full));
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(full);
    }
    return out;
  }

  it("모든 writeAudit 호출이 실행자(userId)를 남긴다", () => {
    const root = path.resolve(__dirname, "..");
    const files = [...sources(path.join(root, "lib")), ...sources(path.join(root, "app"))];
    const missing: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/writeAudit\(\{(.*?)\}\);/gs)) {
        const block = m[1];
        if (block.includes("userId:")) continue;
        const action = /action:\s*"([^"]+)"/.exec(block)?.[1] ?? "?";
        missing.push(`${path.basename(f)} → ${action}`);
      }
    }
    expect(missing, `실행자 없는 감사 기록: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("감사 로그 쓰기", () => {
  it("기록이 실제로 행으로 남는다", async () => {
    const tid = await makeTenant("audit-a");
    await writeAudit({
      action: "customer.delete",
      tenantId: tid,
      targetType: "customer",
      targetId: null,
      metadata: { name: "서울회관", remoteId: "SP649012" },
    });
    const rows = await testDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, tid));
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("customer.delete");
    expect(rows[0].metadata).toMatchObject({ name: "서울회관" });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("★기록이 실패해도 예외를 밖으로 던지지 않는다", async () => {
    // 감사 기록이 안 됐다고 삭제를 되돌리면, 사용자에겐 "삭제 실패"로 보이는데 실제로는
    // 지워졌을 수 있어 더 나쁘다. targetId 에 uuid 가 아닌 값을 넣어 DB 를 실패시킨다.
    await expect(
      writeAudit({
        action: "customer.delete",
        targetId: "이건-uuid-가-아니다",
      }),
    ).resolves.toBeUndefined();
  });

  it("지운 거래처의 상호가 남는다 — uuid 만 남으면 나중에 봐도 모른다", async () => {
    const tid = await makeTenant("audit-b");
    const cid = await makeCustomer(tid, "정안종합식품", "SN3236103");

    // 액션 레이어가 하는 순서 그대로: 먼저 읽고, 지우고, 남긴다.
    const ok = await deleteCustomer(cid, { tenantId: tid });
    expect(ok).toBe(true);
    await writeAudit({
      action: "customer.delete",
      tenantId: tid,
      targetType: "customer",
      targetId: cid,
      metadata: { name: "정안종합식품", remoteId: "SN3236103" },
    });

    const [row] = await testDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, tid));
    expect(row.metadata).toMatchObject({
      name: "정안종합식품",
      remoteId: "SN3236103",
    });
  });

  it("비밀번호 리셋은 남되 비밀번호 자체는 안 남는다", async () => {
    const tid = await makeTenant("audit-c");
    await writeAudit({
      action: "user.password_reset",
      tenantId: tid,
      targetType: "user",
    });
    const [row] = await testDb()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.tenantId, tid));
    expect(row.action).toBe("user.password_reset");
    // metadata 가 없거나, 있어도 비번스러운 키가 없어야 한다.
    const meta = JSON.stringify(row.metadata ?? {});
    for (const banned of ["password", "passwordHash", "hash", "secret"]) {
      expect(meta.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("회사 삭제는 tenant 행이 사라져도 상호가 metadata 로 남는다", async () => {
    const tid = await makeTenant("audit-d");
    // tenant_id FK 는 set null 이라, 회사가 지워지면 그 칸은 비워진다.
    await writeAudit({
      action: "tenant.delete",
      targetType: "tenant",
      targetId: tid,
      metadata: { slug: "audit-d", displayName: "없어진회사", deletedCustomers: 7 },
    });
    const rows = await testDb().select().from(auditLogs);
    const row = rows.find((r) => r.action === "tenant.delete")!;
    expect(row.metadata).toMatchObject({
      slug: "audit-d",
      displayName: "없어진회사",
      deletedCustomers: 7,
    });
  });
});
