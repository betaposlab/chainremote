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
    // 보고는 관제를 켠 거래처에서만 반영된다 — 에이전트도 관제가 꺼져 있으면 안 보낸다.
    const s = await seed("van-c", "주방포스", "VN11110003");
    const token = s.token;
    await setVanWatch("VN11110003", "ksnet", s.tenantId);
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
    const s = await seed("van-d", "홀포스", "VN11110004");
    const token = s.token;
    await setVanWatch("VN11110004", "ksnet", s.tenantId);
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

  // ── 재시작의 성패 (마이그051) ────────────────────────────────────────────
  // 계약: 재시작을 셀 때 **같은 보고의 vanOk** 로 성패까지 가른다. 에이전트는 이미 둘을
  //   함께 보내고 있었고(grace 60초 뒤의 판정), 서버가 짝을 안 봤을 뿐이다.
  it("재시작이 먹혔으면 복구로, 안 먹혔으면 미복구로 센다", async () => {
    const s = await seed("van-out1", "성패포스", "VN11110020");
    const token = s.token;
    await setVanWatch("VN11110020", "ksnet", s.tenantId);

    // 되살렸고 포트도 돌아왔다 → 복구.
    await beat("VN11110020", token, { vanOk: true, vanRestarted: true });
    // 되살렸는데 여전히 닫혀 있다 → 미복구.
    await beat("VN11110020", token, { vanOk: false, vanRestarted: true });

    const r = await row("VN11110020");
    expect(r.vanRestartCount).toBe(2);
    expect(r.vanRecoveredCount).toBe(1);
    expect(r.vanUnrecoveredCount).toBe(1);
  });

  it("재시작 없는 보고는 성패를 건드리지 않는다", async () => {
    const s = await seed("van-out2", "평온포스", "VN11110021");
    const token = s.token;
    await setVanWatch("VN11110021", "ksnet", s.tenantId);

    await beat("VN11110021", token, { vanOk: true });
    await beat("VN11110021", token, { vanOk: false });

    const r = await row("VN11110021");
    expect(r.vanRestartCount).toBe(0);
    expect(r.vanRecoveredCount).toBe(0);
    expect(r.vanUnrecoveredCount).toBe(0);
  });

  it("판정 보류(vanOk=null)면 시도만 세고 성패는 어느 쪽으로도 안 센다", async () => {
    // 리더기를 안 켠 상태다. 모르는 것을 실패로 세면 오탐 판정이 통째로 오염된다.
    const s = await seed("van-out3", "대기포스", "VN11110022");
    const token = s.token;
    await setVanWatch("VN11110022", "ksnet", s.tenantId);

    await beat("VN11110022", token, { vanOk: null, vanRestarted: true });

    const r = await row("VN11110022");
    expect(r.vanRestartCount).toBe(1);
    expect(r.vanRecoveredCount).toBe(0);
    expect(r.vanUnrecoveredCount).toBe(0);
  });

  it("관제를 끈 거래처의 뒤늦은 보고는 성패도 올리지 않는다", async () => {
    // vanOk/vanGaveUp 과 같은 이유다 — 끄기 직전에 출발한 보고가 숫자를 되살리면 안 된다.
    const s = await seed("van-out4", "끈포스", "VN11110023");
    const token = s.token;
    await setVanWatch("VN11110023", "ksnet", s.tenantId);
    await beat("VN11110023", token, { vanOk: true, vanRestarted: true });
    await setVanWatch("VN11110023", "", s.tenantId); // 관제 off (누적도 함께 초기화)

    await beat("VN11110023", token, { vanOk: true, vanRestarted: true });

    const r = await row("VN11110023");
    expect(r.vanRestartCount).toBe(0);
    expect(r.vanRecoveredCount).toBe(0);
    expect(r.vanUnrecoveredCount).toBe(0);
  });

  it("VAN 을 바꾸면 성패 누적도 물려받지 않는다", async () => {
    const s = await seed("van-out5", "교체포스", "VN11110024");
    const token = s.token;
    await setVanWatch("VN11110024", "ksnet", s.tenantId);
    await beat("VN11110024", token, { vanOk: true, vanRestarted: true });
    expect((await row("VN11110024")).vanRecoveredCount).toBe(1);

    await setVanWatch("VN11110024", "kovan", s.tenantId);

    const r = await row("VN11110024");
    expect(r.vanRecoveredCount).toBe(0);
    expect(r.vanUnrecoveredCount).toBe(0);
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

  it("관제를 끈 뒤 뒤늦게 도착한 보고는 상태를 되살리지 않는다", async () => {
    // 에이전트는 heartbeat 응답을 받아야 관제가 꺼진 걸 안다. 끄기 직전에 출발한 마지막
    // 보고가 그 뒤에 도착하는데, 그걸 저장하면 방금 지운 '복구 실패'가 되살아나 껐는데도
    // 빨간 줄이 남는다(2026-08-10 삼성공판장 — 관제 off 인데 van_gave_up=true 로 굳었다).
    const s = await seed("van-h", "포스4", "VN11110008");
    await setVanWatch("VN11110008", "ksnet", s.tenantId);
    await beat("VN11110008", s.token, { vanOk: false, vanGaveUp: true });
    expect((await row("VN11110008")).vanGaveUp).toBe(true);

    await setVanWatch("VN11110008", "", s.tenantId); // 사람이 관제를 끔
    // 에이전트가 아직 모른 채 보낸 마지막 보고
    await beat("VN11110008", s.token, {
      vanOk: false,
      vanGaveUp: true,
      vanMissing: true,
      vanRestarted: true,
    });

    const r = await row("VN11110008");
    expect(r.vanGaveUp).toBe(false);
    expect(r.vanMissing).toBe(false);
    expect(r.vanOk).toBeNull();
    expect(r.vanRestartCount).toBe(0);
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

// ★리더기 대기(판정 보류) 계약 — 2026-08-13.
//
// KSCAT 데몬은 IC 리더기가 켜져 있어야 뜬다. 그래서 "포트가 닫혔다"는 고장만이 아니라
//   영업 준비 전이라는 **정상 상태**이기도 하다. 에이전트는 그때 vanOk 를 **명시적 null**
//   로 보낸다. 필드를 빼면(undefined) 서버가 "변경 없음"으로 읽어 한 번 박힌 빨간 '중지'가
//   영영 안 풀린다 — 신부산오뎅본점이 그렇게 굳어 있었다. 그 차이를 여기서 못박는다.
/** 이 거래처의 VAN 상태를 날것으로 읽는다(판정 보류 계약 검증용). */
async function readVan(remoteId: string) {
  const db = testDb();
  const [row] = await db
    .select({ vanOk: customers.vanOk, vanGaveUp: customers.vanGaveUp })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return row;
}

describe("VAN 판정 보류 (리더기 대기)", () => {
  it("null 을 보내면 기존 '중지'가 '대기'로 풀린다", async () => {
    const db = testDb();
    const [t] = await db
      .insert(tenants)
      .values({ slug: "van-wait", displayName: "van-wait" })
      .returning({ id: tenants.id });
    await db
      .insert(customers)
      .values({ tenantId: t.id, name: "van-wait", remoteId: "VW11110001" });
    const token = (await registerHeartbeatToken("VW11110001"))!;
    await setVanWatch("VW11110001", "ksnet", t.id);

    // 먼저 고장으로 굳힌다.
    await recordHeartbeat("VW11110001", token, "1.4.112", undefined, undefined, undefined, undefined, {
      vanOk: false,
      vanGaveUp: true,
    });
    let row = await readVan("VW11110001");
    expect(row?.vanOk).toBe(false);
    expect(row?.vanGaveUp).toBe(true);

    // 판정 보류를 명시하면 비워져야 한다.
    await recordHeartbeat("VW11110001", token, "1.4.112", undefined, undefined, undefined, undefined, {
      vanOk: null,
    });
    row = await readVan("VW11110001");
    expect(row?.vanOk).toBeNull();
    expect(row?.vanGaveUp).toBe(false);
  });

  it("필드를 아예 안 보내면 기존 값이 보존된다 — null 과 구분된다", async () => {
    const db = testDb();
    const [t] = await db
      .insert(tenants)
      .values({ slug: "van-keep", displayName: "van-keep" })
      .returning({ id: tenants.id });
    await db
      .insert(customers)
      .values({ tenantId: t.id, name: "van-keep", remoteId: "VW11110002" });
    const token = (await registerHeartbeatToken("VW11110002"))!;
    await setVanWatch("VW11110002", "ksnet", t.id);

    await recordHeartbeat("VW11110002", token, "1.4.112", undefined, undefined, undefined, undefined, {
      vanOk: false,
    });
    await recordHeartbeat("VW11110002", token, "1.4.112", undefined, undefined, undefined, undefined, {});
    const row = await readVan("VW11110002");
    expect(row?.vanOk).toBe(false);
  });
});
