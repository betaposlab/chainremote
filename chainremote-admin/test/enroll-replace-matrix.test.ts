// "상호 = 교체 키" enroll 판정 매트릭스 (2026-07-14 재설계) 검증.
//
// 룰: 설치 시 항상 상호 입력. 서버가 기기ID·상호(정규화)로 재설치/기기교체/기기이동을
// 자동 판정하고, 애매한 경우(오타/대상 기기 생존/동명 다수)는 조용히 아무것도 안 바꾸고
// customer_alerts 로 마스터에게 넘긴다. 이 테스트가 빨개지면 매트릭스 안전핀이 풀린 것.

import { describe, it, expect } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { enrollCustomer, normalizeCustomerNameKey } from "@/lib/data/customers";
import {
  customerAlerts,
  customers,
  tenants,
  userFavorites,
  users,
} from "@/lib/schema";

async function seedTenant(slug: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
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

// 살아있는/죽은 기기 시뮬레이션용 heartbeat 시각.
const ALIVE = () => new Date();
const DEAD = () => new Date(Date.now() - 60 * 60_000); // 1시간 전

async function seedCustomer(
  tenantId: string,
  name: string,
  remoteId: string | null,
  lastHeartbeatAt: Date | null,
) {
  const db = testDb();
  const [c] = await db
    .insert(customers)
    .values({ tenantId, name, remoteId, lastHeartbeatAt, enrollStatus: "active" })
    .returning({ id: customers.id });
  return c.id;
}

async function row(id: string) {
  const db = testDb();
  const [r] = await db.select().from(customers).where(eq(customers.id, id));
  return r;
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

describe("상호 정규화 키", () => {
  it("공백·대소문자 차이는 같고, 글자 차이는 다르다", () => {
    expect(normalizeCustomerNameKey("태조산 메인")).toBe(
      normalizeCustomerNameKey("태조산메인"),
    );
    expect(normalizeCustomerNameKey("ABC마트")).toBe(
      normalizeCustomerNameKey("abc 마트"),
    );
    expect(normalizeCustomerNameKey("태조산 메인")).not.toBe(
      normalizeCustomerNameKey("태조산 매인"),
    );
  });
});

describe("enroll 매트릭스 — 재설치(무해 경로)", () => {
  it("같은 기기 + 같은 상호(띄어쓰기 달라도) = 토큰만 회전, 행/알림 무변화", async () => {
    const tid = await seedTenant("t-reinstall");
    const cid = await seedCustomer(tid, "태조산 메인", "RU32534786", DEAD());

    const r = await enrollCustomer(
      { remoteId: "RU32534786", name: "태조산메인" },
      { tenantId: tid },
    );
    expect(r).not.toBe("cross_tenant");

    const c = await row(cid);
    expect(c.name).toBe("태조산 메인"); // 표시 이름은 기존 등록명 유지
    expect(c.remoteId).toBe("RU32534786");
    expect((await openAlerts(tid)).length).toBe(0);
  });

  it("같은 기기 + 상호 미입력(옛 빌드) = 토큰만 회전", async () => {
    const tid = await seedTenant("t-noname");
    const cid = await seedCustomer(tid, "부엌", "77138120", DEAD());
    await enrollCustomer({ remoteId: "77138120" }, { tenantId: tid });
    expect((await row(cid)).name).toBe("부엌");
    expect((await openAlerts(tid)).length).toBe(0);
  });
});

describe("enroll 매트릭스 — 기기 교체 (새 기기 + 기존 상호)", () => {
  it("대상 기기가 죽어있으면 그 거래처에 새 기기 연결 + 즐겨찾기 이전", async () => {
    const tid = await seedTenant("t-replace");
    const uid = await seedUser(tid, "jaesung@t.co");
    const cid = await seedCustomer(tid, "태조산 메인", "RU32534786", DEAD());
    const db = testDb();
    await db.insert(userFavorites).values({
      userId: uid,
      remoteId: "RU32534786",
      customerId: cid,
      tenantId: tid,
    });

    // 새 포스(새 ID)에 같은 상호로 설치
    const r = await enrollCustomer(
      { remoteId: "AB11112222", name: "태조산메인" },
      { tenantId: tid },
    );
    expect(r).not.toBe("cross_tenant");

    const c = await row(cid);
    expect(c.remoteId).toBe("AB11112222"); // 기기 교체 성립
    expect(c.name).toBe("태조산 메인"); // 이름 유지

    // 즐겨찾기가 새 기기 ID 로 따라옴
    const [fav] = await db
      .select()
      .from(userFavorites)
      .where(eq(userFavorites.userId, uid));
    expect(fav.remoteId).toBe("AB11112222");

    // 감사 로그(resolved)만 있고 미해결 알림은 없음
    expect((await openAlerts(tid)).length).toBe(0);
    const logs = await db
      .select()
      .from(customerAlerts)
      .where(eq(customerAlerts.type, "device_replaced"));
    expect(logs.length).toBe(1);
  });

  it("대상 기기가 살아있으면 안 뺏고 새 행 + 동일상호 알림 (멀티포스/동명 보호)", async () => {
    const tid = await seedTenant("t-alive");
    const cid = await seedCustomer(tid, "태조산 메인", "RU32534786", ALIVE());

    await enrollCustomer(
      { remoteId: "AB33334444", name: "태조산 메인" },
      { tenantId: tid },
    );

    expect((await row(cid)).remoteId).toBe("RU32534786"); // 기존 기기 유지
    const db = testDb();
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.tenantId, tid));
    expect(rows.length).toBe(2); // 둘째 행 생성
    expect((await openAlerts(tid, "same_name_new_device")).length).toBe(1);
  });
});

describe("enroll 매트릭스 — 기기 이동 (기존 기기 + 다른 매장 상호)", () => {
  it("대상 매장 기기가 없으면 기기를 옮기고 옛 매장 행은 보존", async () => {
    const tid = await seedTenant("t-move");
    const uid = await seedUser(tid, "chang@t.co");
    const oldCid = await seedCustomer(tid, "태조산 메인", "RU32534786", DEAD());
    const newCid = await seedCustomer(tid, "새매장", null, null); // 기기 없는 매장
    const db = testDb();
    await db.insert(userFavorites).values({
      userId: uid,
      remoteId: "RU32534786",
      customerId: oldCid,
      tenantId: tid,
    });

    // 옛 태조산 기기를 새매장에 재설치 (상호 = 새매장)
    await enrollCustomer(
      { remoteId: "RU32534786", name: "새매장" },
      { tenantId: tid },
    );

    expect((await row(oldCid)).remoteId).toBeNull(); // 기기만 떠남, 행/이력 보존
    expect((await row(newCid)).remoteId).toBe("RU32534786"); // 새매장에 연결

    // 즐겨찾기는 기기를 따라가되 소속 거래처 갱신
    const [fav] = await db
      .select()
      .from(userFavorites)
      .where(eq(userFavorites.userId, uid));
    expect(fav.customerId).toBe(newCid);
    expect((await openAlerts(tid)).length).toBe(0); // device_moved 는 감사 로그
  });

  it("오타(아무 상호와도 불일치)면 아무것도 안 바꾸고 알림 1건 (중복 방지 포함)", async () => {
    const tid = await seedTenant("t-typo");
    const cid = await seedCustomer(tid, "태조산 메인", "RU32534786", DEAD());

    await enrollCustomer(
      { remoteId: "RU32534786", name: "태조산 매인" }, // 오타
      { tenantId: tid },
    );
    await enrollCustomer(
      { remoteId: "RU32534786", name: "태조산 매인" }, // 재시도(하트비트 자가회복)
      { tenantId: tid },
    );

    const c = await row(cid);
    expect(c.remoteId).toBe("RU32534786"); // 기기 유지
    expect(c.name).toBe("태조산 메인"); // 이름 유지
    const alerts = await openAlerts(tid, "reinstalled_new_name");
    expect(alerts.length).toBe(1); // 반복 enroll 에도 1건만
  });
});

describe("enroll 매트릭스 — 격리·기존 동작 보존", () => {
  it("A대리점 상호와 B대리점 신규 상호는 서로 절대 안 붙는다", async () => {
    const ta = await seedTenant("t-a");
    const tb = await seedTenant("t-b");
    const aCid = await seedCustomer(ta, "aa", "AA00000001", DEAD());

    // B대리점에서 같은 상호 aa 로 신규 설치 — A 의 aa 에 절대 안 붙음
    const r = await enrollCustomer(
      { remoteId: "BB00000002", name: "aa" },
      { tenantId: tb },
    );
    expect(r).not.toBe("cross_tenant");

    expect((await row(aCid)).remoteId).toBe("AA00000001"); // A 무변화
    const db = testDb();
    const bRows = await db
      .select()
      .from(customers)
      .where(eq(customers.tenantId, tb));
    expect(bRows.length).toBe(1);
    expect(bRows[0].remoteId).toBe("BB00000002");
    expect((await openAlerts(tb)).length).toBe(0); // 남의 대리점 동명은 알림도 없음
  });

  it("타 대리점 소유 remote_id 는 여전히 cross_tenant 거절", async () => {
    const ta = await seedTenant("t-x");
    const tb = await seedTenant("t-y");
    await seedCustomer(ta, "가게", "ZZ99998888", DEAD());
    const r = await enrollCustomer(
      { remoteId: "ZZ99998888", name: "다른가게" },
      { tenantId: tb },
    );
    expect(r).toBe("cross_tenant");
  });

  it("완전 신규(새 ID + 새 상호)는 그대로 신규 등록", async () => {
    const tid = await seedTenant("t-new");
    await enrollCustomer(
      { remoteId: "NEW1234567", name: "신장개업" },
      { tenantId: tid },
    );
    const db = testDb();
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.tenantId, tid));
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("신장개업");
    expect(rows[0].enrollStatus).toBe("active");
    expect((await openAlerts(tid)).length).toBe(0);
  });
});
