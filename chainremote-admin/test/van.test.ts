// VAN 카드결제 데몬 관제 (마이그 036) — HQ 설정 + heartbeat 보고 왕복 검증.
// 계약:
//  - setVanWatch 는 자기 tenant 거래처만 바꾼다(cross-tenant 거절).
//  - getVanWatch 가 heartbeat 응답에 실려 에이전트가 감시 여부·대상을 정한다. 기본은 빈값(off).
//  - VAN 을 바꾸면 이전 VAN 의 누적/포기 상태를 물려받지 않는다(숫자가 거짓이 되므로).
//  - heartbeat 가 vanOk/vanGaveUp 을 저장하고, vanRestarted=true 일 때만 카운트를 올린다.

import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  registerHeartbeatToken,
  recordHeartbeat,
  getVanWatch,
  setVanWatch,
  getWatchState,
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

const beat = (id: string, token: string, extras: Record<string, unknown>) =>
  recordHeartbeat(
    id, token, "1.4.95", undefined, undefined, undefined, undefined,
    extras,
  );

describe("VAN 카드결제 데몬 관제 (마이그 036)", () => {
  it("기본은 off — VAN 을 지정하면 heartbeat 응답용 getVanWatch 가 그 값을 돌려준다", async () => {
    const s = await seed("van-a", "메인포스", "VN11110001");
    expect(await getVanWatch("VN11110001")).toBe("");

    expect(await setVanWatch("VN11110001", "ksnet", s.tenantId)).toBe(true);
    expect(await getVanWatch("VN11110001")).toBe("ksnet");

    // 빈 문자열 = 관제 해제. null 로 저장되지만 조회는 "" 로 정규화된다.
    expect(await setVanWatch("VN11110001", "", s.tenantId)).toBe(true);
    expect(await getVanWatch("VN11110001")).toBe("");
    expect((await row("VN11110001")).vanWatch).toBeNull();
  });

  it("타 tenant 의 setVanWatch 는 거절된다(거래처 못 찾음)", async () => {
    await seed("van-b", "오더포스", "VN11110002");
    const db = testDb();
    const [other] = await db
      .insert(tenants)
      .values({ slug: "van-b2", displayName: "van-b2" })
      .returning({ id: tenants.id });
    expect(await setVanWatch("VN11110002", "ksnet", other.id)).toBe(false);
    expect(await getVanWatch("VN11110002")).toBe("");
  });

  it("heartbeat 가 vanOk / vanGaveUp 을 저장한다(표시용)", async () => {
    const { token } = await seed("van-c", "주방포스", "VN11110003");
    await beat("VN11110003", token, { vanOk: true, vanGaveUp: false });
    let r = await row("VN11110003");
    expect(r.vanOk).toBe(true);
    expect(r.vanGaveUp).toBe(false);

    // 재실행으로 안 낫는 고장 — 패널이 빨간 칩으로 사람을 부른다.
    await beat("VN11110003", token, { vanOk: false, vanGaveUp: true });
    r = await row("VN11110003");
    expect(r.vanOk).toBe(false);
    expect(r.vanGaveUp).toBe(true);
  });

  it("vanRestarted=true 인 heartbeat 만 카운트를 올리고 마지막 시각을 찍는다", async () => {
    const { token } = await seed("van-d", "홀포스", "VN11110004");
    // 평범한 heartbeat — 카운트 0 유지
    await beat("VN11110004", token, { vanOk: true });
    let r = await row("VN11110004");
    expect(r.vanRestartCount).toBe(0);
    expect(r.vanLastRestartAt).toBeNull();

    await beat("VN11110004", token, { vanOk: true, vanRestarted: true });
    await beat("VN11110004", token, { vanOk: true, vanRestarted: true });
    r = await row("VN11110004");
    expect(r.vanRestartCount).toBe(2);
    expect(r.vanLastRestartAt).not.toBeNull();
  });

  it("getWatchState 는 HQ 다이얼로그가 볼 현재 상태를 주고, 남의 tenant 는 막는다", async () => {
    // HQ 로컬 peer 캐시(최근 세션 탭)엔 관제 필드가 없어 "꺼짐"으로 오독된다. 그래서
    // 다이얼로그는 캐시 대신 이 경로로 묻는다 — 값이 정확해야 하는 자리다.
    const s = await seed("van-f", "포스2", "VN11110006");
    await setVanWatch("VN11110006", "ksnet", s.tenantId);
    await beat("VN11110006", s.token, { vanOk: true, vanRestarted: true });

    const mine = await getWatchState("VN11110006", s.tenantId);
    expect(mine?.vanWatch).toBe("ksnet");
    expect(mine?.vanOk).toBe(true);
    expect(mine?.vanGaveUp).toBe(false);
    expect(mine?.vanRestartCount).toBe(1);
    expect(mine?.firewallControl).toBe(false);

    const db = testDb();
    const [other] = await db
      .insert(tenants)
      .values({ slug: "van-f2", displayName: "van-f2" })
      .returning({ id: tenants.id });
    expect(await getWatchState("VN11110006", other.id)).toBeNull();
  });

  it("vanMissing 은 복구 실패와 따로 저장된다(조치가 반대라 화면에서 갈라야 한다)", async () => {
    // 다른 VAN 을 쓰는 거래처에 관제를 잘못 켠 경우. 리더기 고장은 사람이 가야 하지만
    // 이쪽은 관제만 끄면 끝나므로, 같은 '복구 실패'로 뭉뚱그리면 헛걸음을 부른다.
    const s = await seed("van-g", "포스3", "VN11110007");
    await setVanWatch("VN11110007", "ksnet", s.tenantId);
    await beat("VN11110007", s.token, {
      vanOk: false,
      vanGaveUp: true,
      vanMissing: true,
    });
    let r = await row("VN11110007");
    expect(r.vanGaveUp).toBe(true);
    expect(r.vanMissing).toBe(true);
    // 되살리기를 시도조차 안 하므로 카운트는 오르지 않는다.
    expect(r.vanRestartCount).toBe(0);

    // 관제를 끄면 깨끗해진다 — 사람이 할 조치가 이것뿐이다.
    await setVanWatch("VN11110007", "", s.tenantId);
    r = await row("VN11110007");
    expect(r.vanMissing).toBe(false);
    expect(r.vanGaveUp).toBe(false);
  });

  it("VAN 을 바꾸면 이전 VAN 의 누적·포기 상태를 물려받지 않는다", async () => {
    const s = await seed("van-e", "포스1", "VN11110005");
    await setVanWatch("VN11110005", "ksnet", s.tenantId);
    await beat("VN11110005", s.token, {
      vanOk: false,
      vanGaveUp: true,
      vanRestarted: true,
    });
    let r = await row("VN11110005");
    expect(r.vanRestartCount).toBe(1);
    expect(r.vanGaveUp).toBe(true);

    // 관제를 껐다 켜면 깨끗한 상태에서 다시 센다 — 다른 VAN 의 이력이 남으면 숫자가 거짓이 된다.
    await setVanWatch("VN11110005", "", s.tenantId);
    r = await row("VN11110005");
    expect(r.vanRestartCount).toBe(0);
    expect(r.vanGaveUp).toBe(false);
    expect(r.vanOk).toBeNull();
    expect(r.vanLastRestartAt).toBeNull();
  });
});
