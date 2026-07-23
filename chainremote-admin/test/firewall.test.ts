// 방화벽 자동 해제 관제 (마이그 028) — HQ 토글 + heartbeat 보고 왕복 검증.
// 계약:
//  - setFirewallControl 은 자기 tenant 거래처만 바꾼다(cross-tenant 거절).
//  - getFirewallControl 이 heartbeat 응답에 실려(에이전트가 감시 여부 결정) 기본은 off.
//  - heartbeat 가 firewallEnabled(표시용) 를 저장한다.
//  - firewallDisarmed=true 인 heartbeat 만 disarm 카운트를 올리고 마지막 시각을 찍는다.

import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  registerHeartbeatToken,
  recordHeartbeat,
  getFirewallControl,
  setFirewallControl,
} from "@/lib/data/customers";
import { tenants, customers } from "@/lib/schema";

async function seed(slug: string, name: string, remoteId: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  await db.insert(customers).values({ tenantId: t.id, name, remoteId });
  const token = await registerHeartbeatToken(remoteId);
  return { tenantId: t.id, token: token! };
}

async function row(remoteId: string) {
  const db = testDb();
  const [r] = await db
    .select()
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return r;
}

describe("방화벽 자동 해제 관제 (마이그 028)", () => {
  it("기본은 off — 관제를 켜면 heartbeat 응답용 getFirewallControl 이 참을 돌려준다", async () => {
    const s = await seed("fw-a", "메인포스", "FW11110001");
    expect(await getFirewallControl("FW11110001")).toBe(false);

    expect(await setFirewallControl("FW11110001", true, s.tenantId)).toBe(true);
    expect(await getFirewallControl("FW11110001")).toBe(true);

    expect(await setFirewallControl("FW11110001", false, s.tenantId)).toBe(true);
    expect(await getFirewallControl("FW11110001")).toBe(false);
  });

  it("타 tenant 의 setFirewallControl 은 거절된다(거래처 못 찾음)", async () => {
    await seed("fw-b", "오더포스", "FW11110002");
    const db = testDb();
    const [other] = await db
      .insert(tenants)
      .values({ slug: "fw-b2", displayName: "fw-b2" })
      .returning({ id: tenants.id });
    expect(await setFirewallControl("FW11110002", true, other.id)).toBe(false);
    // 관제가 안 켜졌는지 확인
    expect(await getFirewallControl("FW11110002")).toBe(false);
  });

  it("heartbeat 가 firewallEnabled 를 저장한다(표시용)", async () => {
    const { token } = await seed("fw-c", "주방포스", "FW11110003");
    await recordHeartbeat(
      "FW11110003", token, "1.4.68", undefined, undefined, undefined, undefined,
      { firewallEnabled: true },
    );
    expect((await row("FW11110003")).firewallEnabled).toBe(true);
    await recordHeartbeat(
      "FW11110003", token, "1.4.68", undefined, undefined, undefined, undefined,
      { firewallEnabled: false },
    );
    expect((await row("FW11110003")).firewallEnabled).toBe(false);
  });

  it("firewallDisarmed=true 인 heartbeat 만 카운트를 올리고 마지막 시각을 찍는다", async () => {
    const { token } = await seed("fw-d", "홀포스", "FW11110004");
    // 자동 해제 없는 평범한 heartbeat — 카운트 0 유지
    await recordHeartbeat(
      "FW11110004", token, "1.4.68", undefined, undefined, undefined, undefined,
      { firewallEnabled: false },
    );
    let r = await row("FW11110004");
    expect(r.firewallDisarmCount).toBe(0);
    expect(r.firewallLastDisarmAt).toBeNull();

    // 자동 해제 보고 두 번 → 카운트 2, 시각 기록
    await recordHeartbeat(
      "FW11110004", token, "1.4.68", undefined, undefined, undefined, undefined,
      { firewallEnabled: true, firewallDisarmed: true },
    );
    await recordHeartbeat(
      "FW11110004", token, "1.4.68", undefined, undefined, undefined, undefined,
      { firewallEnabled: false, firewallDisarmed: true },
    );
    r = await row("FW11110004");
    expect(r.firewallDisarmCount).toBe(2);
    expect(r.firewallLastDisarmAt).not.toBeNull();
  });
});
