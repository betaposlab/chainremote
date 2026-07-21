// 적대적 테스트 — enroll "상호 = 교체 키" 매트릭스 (재설치/기기교체/이동 자동판정 + 애매성 배너).
//
// enroll-replace-matrix.test.ts 가 행복경로 매트릭스를 지킨다면, 이 파일은 경계·시계스큐·
// 동명다수·cross-tenant 선행성·배너결정 격리·enroll 라우트 인증·유니코드 정규화 같은
// "안전핀이 풀리는 순간"을 노린다. 소스는 절대 수정하지 않는다 — 결함이면 버그 후보로만 남긴다.

import { describe, it, expect } from "vitest";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { enrollCustomer, normalizeCustomerNameKey } from "@/lib/data/customers";
import {
  resolveAlert,
  applyAlertRename,
  applyAlertMoveToNew,
  parseAlertDetail,
} from "@/lib/data/alerts";
import { POST as enrollPOST } from "@/app/api/customers/enroll/route";
import { hashHeartbeatToken } from "@/lib/heartbeat-token";
import {
  customerAlerts,
  customers,
  tenants,
  userFavorites,
  users,
} from "@/lib/schema";

// ── 시드 헬퍼 (enroll-replace-matrix.test.ts 규약 그대로) ──────────────────────
async function seedTenant(
  slug: string,
  opts?: { enrollKey?: string; isActive?: boolean },
) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({
      slug,
      displayName: slug,
      isActive: opts?.isActive ?? true,
      ...(opts?.enrollKey
        ? { enrollSecretHash: hashHeartbeatToken(opts.enrollKey) }
        : {}),
    })
    .returning({ id: tenants.id });
  return t.id;
}

async function seedUser(tenantId: string, email: string) {
  const db = testDb();
  const [u] = await db
    .insert(users)
    .values({ tenantId, email, passwordHash: "x", displayName: email })
    .returning({ id: users.id });
  return u.id;
}

async function seedCustomer(
  tenantId: string,
  name: string,
  remoteId: string | null,
  lastHeartbeatAt: Date | null,
  enrollStatus: string = "active",
) {
  const db = testDb();
  const [c] = await db
    .insert(customers)
    .values({ tenantId, name, remoteId, lastHeartbeatAt, enrollStatus })
    .returning({ id: customers.id });
  return c.id;
}

async function row(id: string) {
  const db = testDb();
  const [r] = await db.select().from(customers).where(eq(customers.id, id));
  return r;
}

async function customerCount(tenantId: string) {
  const db = testDb();
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.tenantId, tenantId));
  return rows.length;
}

async function openAlerts(tenantId: string, type?: string) {
  const db = testDb();
  return db
    .select()
    .from(customerAlerts)
    .where(
      and(
        eq(customerAlerts.tenantId, tenantId),
        isNull(customerAlerts.resolvedAt),
        ...(type ? [eq(customerAlerts.type, type)] : []),
      ),
    );
}

async function alertsByType(tenantId: string, type: string) {
  const db = testDb();
  return db
    .select()
    .from(customerAlerts)
    .where(
      and(eq(customerAlerts.tenantId, tenantId), eq(customerAlerts.type, type)),
    );
}

// 시각 헬퍼 — deviceAlive 임계값(15분) 경계.
const ALIVE_NOW = () => new Date();
const DEAD_1H = () => new Date(Date.now() - 60 * 60_000);
const EXACT_15M = () => new Date(Date.now() - 15 * 60_000); // 정확히 임계값 (strict < 라 DEAD)
const JUST_ALIVE = () => new Date(Date.now() - (15 * 60_000 - 1000)); // 14:59 → ALIVE
const FUTURE_10M = () => new Date(Date.now() + 10 * 60_000); // 미래 하트비트 (시계스큐)

let ipSeq = 100; // 라우트 rate-limit 버킷 격리용 — 매 요청 고유 IP
const nextIp = () => `10.${(ipSeq++ % 250) + 1}.0.1`;

async function enrollReq(body: Record<string, unknown>) {
  const res = await enrollPOST(
    new Request("http://x/api/customers/enroll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": nextIp(),
      },
      body: JSON.stringify(body),
    }),
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

// ─────────────────────────────────────────────────────────────────────────────
// ER-01 — cross_tenant 판정이 로컬 동명 기기교체보다 선행
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-01 cross_tenant 선행성 — 남의 기기 ID + 내 대리점 동명", () => {
  it("타 대리점 소유 remote_id 는 내 대리점 동명 매장이 있어도 cross_tenant 로 컷", async () => {
    const A = await seedTenant("er01-a");
    const B = await seedTenant("er01-b");
    const aCid = await seedCustomer(A, "본점", "AA00000001", ALIVE_NOW());
    // B 에 죽은 동명 'aa' 를 심어 상호기반 replace 유혹을 만든다.
    const bCid = await seedCustomer(B, "aa", "BB00000009", DEAD_1H());

    // B 로 남의 기기(A 소유 AA00000001) + 내 매장 동명('aa') enroll
    const r = await enrollCustomer(
      { remoteId: "AA00000001", name: "aa" },
      { tenantId: B },
    );
    expect(r).toBe("cross_tenant");

    // B 의 'aa' 는 remoteId 가 절대 A 기기로 안 바뀜 (교체/이동 미발생)
    expect((await row(bCid)).remoteId).toBe("BB00000009");
    // A 행 무변화
    expect((await row(aCid)).remoteId).toBe("AA00000001");
    // 어느 쪽에도 새 행/알림 미생성
    expect(await customerCount(B)).toBe(1);
    expect((await openAlerts(B)).length).toBe(0);
    expect((await openAlerts(A)).length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ER-02 — deviceAlive 15분 경계 off-by-one + 미래시각(시계스큐)
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-02 deviceAlive 경계 + 시계스큐", () => {
  it("(a) 정확히 15분 = DEAD (strict <) → 새 기기 자동 교체", async () => {
    const T = await seedTenant("er02-a");
    const cid = await seedCustomer(T, "카페", "OLD0000001", EXACT_15M());
    const r = await enrollCustomer(
      { remoteId: "NEWAA00001", name: "카페" },
      { tenantId: T },
    );
    expect(r).not.toBe("cross_tenant");
    expect((await row(cid)).remoteId).toBe("NEWAA00001"); // 교체 성립
    expect((await openAlerts(T)).length).toBe(0);
    expect((await alertsByType(T, "device_replaced")).length).toBe(1);
    expect(await customerCount(T)).toBe(1); // 새 행 없이 흡착
  });

  it("(b) 14분59초 = ALIVE → 교체 거부, 새 행 + same_name_new_device", async () => {
    const T = await seedTenant("er02-b");
    const cid = await seedCustomer(T, "카페", "OLD0000002", JUST_ALIVE());
    await enrollCustomer(
      { remoteId: "NEWBB00002", name: "카페" },
      { tenantId: T },
    );
    expect((await row(cid)).remoteId).toBe("OLD0000002"); // 기존 기기 유지
    expect(await customerCount(T)).toBe(2); // 둘째 행 생성
    expect((await openAlerts(T, "same_name_new_device")).length).toBe(1);
  });

  it("(c) 미래시각 하트비트 = ALIVE 판정 → 교체 거부 (스큐로 영구 교체불가 노출)", async () => {
    const T = await seedTenant("er02-c");
    const cid = await seedCustomer(T, "카페", "OLD0000003", FUTURE_10M());
    await enrollCustomer(
      { remoteId: "NEWCC00003", name: "카페" },
      { tenantId: T },
    );
    // Date.now()-미래<0<15분 → ALIVE → 교체 거부. (실서버는 lastHeartbeatAt 을 항상
    //   서버시각으로 세팅하므로 에이전트 경로로는 미래시각 도달 불가 = 이론적 스큐 취약점.)
    expect((await row(cid)).remoteId).toBe("OLD0000003");
    expect(await customerCount(T)).toBe(2);
    expect((await openAlerts(T, "same_name_new_device")).length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ER-03 — 동명 다수(dead) + 새 기기 = 애매, 자동 흡착 금지
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-03 동명 다수 + 새 기기 = 사람에게 (자동 병합 금지)", () => {
  it("죽은 동명 2건 사이로 새 기기가 오면 어디에도 안 붙고 3번째 행 + 알림 1건", async () => {
    const T = await seedTenant("er03");
    const c1 = await seedCustomer(T, "메인점", "MM00000001", DEAD_1H());
    const c2 = await seedCustomer(T, "메인점", "MM00000002", DEAD_1H());
    await enrollCustomer(
      { remoteId: "NEWMM00003", name: "메인점" },
      { tenantId: T },
    );
    // 두 기존 매장 remoteId 무변화 (자동 교체 안전핀)
    expect((await row(c1)).remoteId).toBe("MM00000001");
    expect((await row(c2)).remoteId).toBe("MM00000002");
    expect(await customerCount(T)).toBe(3); // 새 행 생성
    expect((await openAlerts(T, "same_name_new_device")).length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ER-04 — 같은 기기 재enroll + 새 상호가 동명 다수와 일치 = reason '동명 다수'
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-04 애매 분기 reason 판별", () => {
  it("byId 존재 + 상호불일치 + byNameCount=2 → reinstalled_new_name, reason='동명 다수'", async () => {
    const T = await seedTenant("er04");
    const home = await seedCustomer(T, "옛집", "XX00000001", DEAD_1H());
    await seedCustomer(T, "공용", "GG00000001", DEAD_1H());
    await seedCustomer(T, "공용", "GG00000002", DEAD_1H());

    await enrollCustomer(
      { remoteId: "XX00000001", name: "공용" }, // 기기 X 가 동명 다수 상호로 재설치
      { tenantId: T },
    );

    const c = await row(home);
    expect(c.remoteId).toBe("XX00000001"); // 기기 무변화
    expect(c.name).toBe("옛집"); // 이름 무변화 (이동/교체 미발생)
    const alerts = await openAlerts(T, "reinstalled_new_name");
    expect(alerts.length).toBe(1);
    expect(parseAlertDetail(alerts[0].detail).reason).toBe("동명 다수");
  });

  it("대상 기기 살아있으면 reason='대상 기기 사용 중'", async () => {
    const T = await seedTenant("er04b");
    const home = await seedCustomer(T, "옛집", "XY00000001", DEAD_1H());
    await seedCustomer(T, "라이브", "LV00000001", ALIVE_NOW());
    await enrollCustomer(
      { remoteId: "XY00000001", name: "라이브" },
      { tenantId: T },
    );
    expect((await row(home)).remoteId).toBe("XY00000001");
    const alerts = await openAlerts(T, "reinstalled_new_name");
    expect(alerts.length).toBe(1);
    expect(parseAlertDetail(alerts[0].detail).reason).toBe("대상 기기 사용 중");
  });

  it("일치 상호 아예 없으면 reason='일치 상호 없음'", async () => {
    const T = await seedTenant("er04c");
    const home = await seedCustomer(T, "옛집", "XZ00000001", DEAD_1H());
    await enrollCustomer(
      { remoteId: "XZ00000001", name: "존재안함매장" },
      { tenantId: T },
    );
    expect((await row(home)).name).toBe("옛집");
    const alerts = await openAlerts(T, "reinstalled_new_name");
    expect(alerts.length).toBe(1);
    expect(parseAlertDetail(alerts[0].detail).reason).toBe("일치 상호 없음");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ER-05 — 배너 결정(resolve/rename/move)의 cross-tenant 격리
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-05 배너 결정 cross-tenant 격리", () => {
  async function seedOpenReinstallAlert(tenantId: string) {
    // A 의 매장 S(기기 X, dead)에 오타 상호로 enroll → 미해결 reinstalled_new_name 생성.
    const sid = await seedCustomer(tenantId, "정상매장", "SS00000001", DEAD_1H());
    await enrollCustomer(
      { remoteId: "SS00000001", name: "오타매장" },
      { tenantId },
    );
    const [alert] = await openAlerts(tenantId, "reinstalled_new_name");
    return { sid, alertId: alert.id };
  }

  it("남의 tenant 로 resolve/rename/move 호출 시 전부 false + A 무변화 + B 팬텀 없음", async () => {
    const A = await seedTenant("er05-a");
    const B = await seedTenant("er05-b");
    const { sid, alertId } = await seedOpenReinstallAlert(A);
    const beforeName = (await row(sid)).name;
    const beforeRemote = (await row(sid)).remoteId;

    expect(await resolveAlert(alertId, B)).toBe(false);
    expect(await applyAlertRename(alertId, B)).toBe(false);
    expect(await applyAlertMoveToNew(alertId, B)).toBe(false);

    // A 의 알림은 여전히 미해결
    expect((await openAlerts(A, "reinstalled_new_name")).length).toBe(1);
    // A 거래처 name/remoteId 무변화
    expect((await row(sid)).name).toBe(beforeName);
    expect((await row(sid)).remoteId).toBe(beforeRemote);
    // B 에 팬텀 거래처 미생성
    expect(await customerCount(B)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ER-06 — enroll 라우트 인증경로 (위조/정지테넌트/필드누락)
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-06 enroll 라우트 인증", () => {
  it("(a) 올바른 slug + 틀린 enrollKey → 403, 거래처 미생성", async () => {
    const T = await seedTenant("er06-a", { enrollKey: "RIGHTKEY" });
    const { status } = await enrollReq({
      remoteId: "RA00000001",
      tenantSlug: "er06-a",
      enrollKey: "WRONGKEY",
      name: "가게",
    });
    expect(status).toBe(403);
    expect(await customerCount(T)).toBe(0);
  });

  it("(b) 정지 대리점(isActive=false)은 올바른 키여도 403, 거래처 미생성", async () => {
    const T = await seedTenant("er06-b", { enrollKey: "GOODKEY", isActive: false });
    const { status } = await enrollReq({
      remoteId: "RB00000001",
      tenantSlug: "er06-b",
      enrollKey: "GOODKEY",
      name: "가게",
    });
    expect(status).toBe(403);
    expect(await customerCount(T)).toBe(0);
  });

  it("(c) remoteId 누락 → 400 'remoteId 필수'", async () => {
    await seedTenant("er06-c", { enrollKey: "GOODKEY" });
    const { status, json } = await enrollReq({
      tenantSlug: "er06-c",
      enrollKey: "GOODKEY",
      name: "가게",
    });
    expect(status).toBe(400);
    expect(String(json.error)).toContain("remoteId");
  });

  it("(d) tenantSlug/enrollKey 누락 → 400 'tenant 인증 정보 필수'", async () => {
    const { status, json } = await enrollReq({
      remoteId: "RD00000001",
      name: "가게",
    });
    expect(status).toBe(400);
    expect(String(json.error)).toContain("tenant");
  });

  it("(e) 정상 active 테넌트 → 200 + token + enrollStatus 'active' 행", async () => {
    const T = await seedTenant("er06-e", { enrollKey: "GOODKEY" });
    const { status, json } = await enrollReq({
      remoteId: "RE00000001",
      tenantSlug: "er06-e",
      enrollKey: "GOODKEY",
      name: "신규가게",
    });
    expect(status).toBe(200);
    expect(typeof json.token).toBe("string");
    expect((json.token as string).length).toBeGreaterThan(0);
    const db = testDb();
    const [c] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, T), eq(customers.remoteId, "RE00000001")));
    expect(c).toBeTruthy();
    expect(c.enrollStatus).toBe("active");
    expect(c.name).toBe("신규가게");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ER-07 — null-device 사전등록 매장 온보딩(카페리치) + enrollStatus 보존
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-07 사전등록(null 기기) 매장 온보딩", () => {
  it("byName 흡착: remoteId 세팅 + device_replaced(from=null) + 크래시 없음", async () => {
    const T = await seedTenant("er07");
    const cid = await seedCustomer(T, "카페리치", null, null, "pending");
    const r = await enrollCustomer(
      { remoteId: "NEWFC00001", name: "카페리치" },
      { tenantId: T },
    );
    expect(r).not.toBe("cross_tenant");

    const c = await row(cid);
    expect(c.remoteId).toBe("NEWFC00001"); // 흡착
    expect(await customerCount(T)).toBe(1); // 새 행 없음
    expect((await openAlerts(T)).length).toBe(0); // 미해결 알림 0

    const rep = await alertsByType(T, "device_replaced");
    expect(rep.length).toBe(1);
    expect(parseAlertDetail(rep[0].detail).from).toBeNull(); // detail.from===null

    // ★replace 경로가 enroll_status 를 안 건드려 'pending' 그대로 — 실기기 살아있어도
    //   패널엔 여전히 미확정으로 표기됨(설계 확인 포인트, 현재 동작 문서화).
    expect(c.enrollStatus).toBe("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ER-08 — 상호 정규화 과매칭/미폴딩 (전각·원문자·제로폭공백)
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-08 상호 정규화 경계", () => {
  it("(a) 전각 ＴＥＳＴ분식 == test분식 (NFKC 정상) → 자동 교체, 애매 알림 없음", async () => {
    expect(normalizeCustomerNameKey("ＴＥＳＴ분식")).toBe(
      normalizeCustomerNameKey("test분식"),
    );
    const T = await seedTenant("er08-a");
    const cid = await seedCustomer(T, "test분식", "TF00000001", DEAD_1H());
    await enrollCustomer(
      { remoteId: "NEWTF00002", name: "ＴＥＳＴ분식" },
      { tenantId: T },
    );
    expect((await row(cid)).remoteId).toBe("NEWTF00002"); // 전각/반각 동일 매장 교체
    expect((await openAlerts(T)).length).toBe(0);
    expect((await alertsByType(T, "device_replaced")).length).toBe(1);
  });

  it("(b) 원문자 카페① == 카페1 (NFKC 과매칭) → 서로 다른 매장이 자동 흡착됨 [위험 문서화]", async () => {
    // NFKC 가 ① → 1 로 접어 '카페①' 과 '카페1' 이 동일키가 된다. 실무상 서로 다른 매장일 수
    //   있으나 자동 교체가 성립 = '잘못 붙는 게 더 위험' 설계원칙에 반하는 과매칭 위험을 실증.
    //   (표준 NFKC 동작이자 코드가 의도한 정규화라 강제 실패는 아님 — 현재 동작 명시 검증.)
    expect(normalizeCustomerNameKey("카페①")).toBe(
      normalizeCustomerNameKey("카페1"),
    );
    const T = await seedTenant("er08-b");
    const cid = await seedCustomer(T, "카페1", "CF00000001", DEAD_1H());
    await enrollCustomer(
      { remoteId: "NEWCF00002", name: "카페①" },
      { tenantId: T },
    );
    // 과매칭으로 교체가 성립한다(현재 동작). 별개 매장이었다면 오배선.
    expect((await row(cid)).remoteId).toBe("NEWCF00002");
  });

  it("(c) 제로폭공백은 폴딩 안 됨 → same_name 아닌 애매 알림 (안전방향, 보이지 않는 실패)", async () => {
    const zwsp = "태조산​메인";
    expect(normalizeCustomerNameKey(zwsp)).not.toBe(
      normalizeCustomerNameKey("태조산 메인"),
    );
    const T = await seedTenant("er08-c");
    const cid = await seedCustomer(T, "태조산 메인", "ZW00000001", DEAD_1H());
    await enrollCustomer(
      { remoteId: "ZW00000001", name: zwsp }, // 같은 기기, ZWSP 삽입한 눈에 같은 이름
      { tenantId: T },
    );
    const c = await row(cid);
    expect(c.remoteId).toBe("ZW00000001"); // 기기 유지
    expect(c.name).toBe("태조산 메인"); // 이름 유지
    // same_name 재설치가 아니라 애매 알림으로 떨어짐(안전 방향).
    expect((await openAlerts(T, "reinstalled_new_name")).length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ER-09 — applyAlertMoveToNew 스테일 방어 (팬텀/중복 remoteId 금지)
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-09 [이동] 스테일 배너 방어", () => {
  it("알림 생성 후 기기가 이미 딴 데로 갔으면 false + 새 행/중복 remoteId 미생성", async () => {
    const T = await seedTenant("er09");
    const sid = await seedCustomer(T, "정상매장", "MV00000001", DEAD_1H());
    // 오타 상호로 enroll → reinstalled_new_name(detail.remoteId = MV00000001)
    await enrollCustomer(
      { remoteId: "MV00000001", name: "오타신규매장" },
      { tenantId: T },
    );
    const [alert] = await openAlerts(T, "reinstalled_new_name");
    expect(parseAlertDetail(alert.detail).remoteId).toBe("MV00000001");

    // 이후 기기 X 가 딴 데로 가서 S.remoteId 가 null 로 바뀜(스테일).
    const db = testDb();
    await db
      .update(customers)
      .set({ remoteId: null })
      .where(eq(customers.id, sid));

    const before = await customerCount(T);
    const ok = await applyAlertMoveToNew(alert.id, T);
    expect(ok).toBe(false); // src.remoteId !== detail.remoteId → 스테일 컷
    expect(await customerCount(T)).toBe(before); // 새 행 없음
    // detail.remoteId 로 팬텀 remoteId insert 안 함
    const phantom = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, "MV00000001"));
    expect(phantom.length).toBe(0);
    // 알림 여전히 미해결
    expect((await openAlerts(T, "reinstalled_new_name")).length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ER-10 — applyAlertRename 가드 (오타입/빈 이름/멱등)
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-10 [상호만 변경] 가드", () => {
  it("(a) 잘못된 타입(device_replaced) 알림 id → false, 거래처명 무변화", async () => {
    const T = await seedTenant("er10-a");
    const cid = await seedCustomer(T, "원래이름", "RN00000001", DEAD_1H());
    const db = testDb();
    // 미해결 device_replaced 알림 직접 주입(타입 게이트만 검증).
    const [al] = await db
      .insert(customerAlerts)
      .values({
        tenantId: T,
        customerId: cid,
        type: "device_replaced",
        detail: JSON.stringify({ newName: "바뀌면안됨" }),
      })
      .returning({ id: customerAlerts.id });
    expect(await applyAlertRename(al.id, T)).toBe(false);
    expect((await row(cid)).name).toBe("원래이름");
  });

  it("(b) reinstalled_new_name 이지만 newName 공백뿐 → false, 무변화", async () => {
    const T = await seedTenant("er10-b");
    const cid = await seedCustomer(T, "원래이름", "RN00000002", DEAD_1H());
    const db = testDb();
    const [al] = await db
      .insert(customerAlerts)
      .values({
        tenantId: T,
        customerId: cid,
        type: "reinstalled_new_name",
        detail: JSON.stringify({ remoteId: "RN00000002", newName: "   " }),
      })
      .returning({ id: customerAlerts.id });
    expect(await applyAlertRename(al.id, T)).toBe(false);
    expect((await row(cid)).name).toBe("원래이름");
  });

  it("(c) 정상 rename 성공 후 같은 alertId 재호출 → false (멱등), 이름 오염 없음", async () => {
    const T = await seedTenant("er10-c");
    const cid = await seedCustomer(T, "원래이름", "RN00000003", DEAD_1H());
    const db = testDb();
    const [al] = await db
      .insert(customerAlerts)
      .values({
        tenantId: T,
        customerId: cid,
        type: "reinstalled_new_name",
        detail: JSON.stringify({ remoteId: "RN00000003", newName: "새간판" }),
      })
      .returning({ id: customerAlerts.id });
    expect(await applyAlertRename(al.id, T)).toBe(true);
    expect((await row(cid)).name).toBe("새간판");
    // 이미 resolved → 두번째 호출은 getOpenAlert 에서 제외 → false
    expect(await applyAlertRename(al.id, T)).toBe(false);
    expect((await row(cid)).name).toBe("새간판"); // 오염 없음
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ER-11 — [무시] 후 재enroll 시 알림 재생성(재-nag)
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-11 [무시] 후 재enroll 재알림 특성", () => {
  it("무시로 resolved 후 같은 오타로 재enroll 하면 새 미해결 알림이 다시 뜬다", async () => {
    const T = await seedTenant("er11");
    const cid = await seedCustomer(T, "정상매장", "NG00000001", DEAD_1H());

    // 1) 오타 enroll → 미해결 1건
    await enrollCustomer(
      { remoteId: "NG00000001", name: "오타상호" },
      { tenantId: T },
    );
    let open = await openAlerts(T, "reinstalled_new_name");
    expect(open.length).toBe(1);

    // 2) [무시]
    expect(await resolveAlert(open[0].id, T)).toBe(true);
    expect((await openAlerts(T, "reinstalled_new_name")).length).toBe(0);

    // 3) 같은 오타로 재enroll(자가회복) → dedup 은 미해결만 검사하므로 새 미해결 1건 재출현
    await enrollCustomer(
      { remoteId: "NG00000001", name: "오타상호" },
      { tenantId: T },
    );
    // 4) 또 재enroll → 미해결 이미 1건이라 이번엔 dedup(추가 안 됨)
    await enrollCustomer(
      { remoteId: "NG00000001", name: "오타상호" },
      { tenantId: T },
    );

    open = await openAlerts(T, "reinstalled_new_name");
    expect(open.length).toBe(1); // 미해결은 항상 최대 1건
    // 총 reinstalled_new_name = resolved 1 + open 1 = 2 (무시가 향후 재알림을 못 막음)
    expect((await alertsByType(T, "reinstalled_new_name")).length).toBe(2);
    expect(cid).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ER-12 — 기기 교체 시 다중 사용자 즐겨찾기 완전 이전
// ─────────────────────────────────────────────────────────────────────────────
describe("ER-12 교체 시 다중 사용자 즐겨찾기 이전", () => {
  it("OLD 를 가리키던 두 사용자 즐겨찾기가 둘 다 NEW 로, 고아 0건", async () => {
    const T = await seedTenant("er12");
    const uJae = await seedUser(T, "jaesung@t.co");
    const uChang = await seedUser(T, "chang@t.co");
    const cid = await seedCustomer(T, "공유매장", "OLDAA00001", DEAD_1H());
    const db = testDb();
    await db.insert(userFavorites).values([
      { userId: uJae, remoteId: "OLDAA00001", customerId: cid, tenantId: T },
      { userId: uChang, remoteId: "OLDAA00001", customerId: cid, tenantId: T },
    ]);

    await enrollCustomer(
      { remoteId: "NEWAA00002", name: "공유매장" },
      { tenantId: T },
    );
    expect((await row(cid)).remoteId).toBe("NEWAA00002"); // 교체 성립

    const favs = await db
      .select()
      .from(userFavorites)
      .where(eq(userFavorites.tenantId, T));
    expect(favs.length).toBe(2);
    // 둘 다 NEW 로 갱신
    expect(favs.every((f) => f.remoteId === "NEWAA00002")).toBe(true);
    // OLD 고아 0건
    const orphans = await db
      .select()
      .from(userFavorites)
      .where(
        and(
          eq(userFavorites.tenantId, T),
          eq(userFavorites.remoteId, "OLDAA00001"),
        ),
      );
    expect(orphans.length).toBe(0);
    // 참고: isNotNull import 사용 (미사용 경고 회피 아님 — 명시 검증용)
    const named = await db
      .select()
      .from(userFavorites)
      .where(and(eq(userFavorites.tenantId, T), isNotNull(userFavorites.remoteId)));
    expect(named.length).toBe(2);
  });
});
