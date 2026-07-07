import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  listCustomers,
  getCustomer,
  updateCustomer,
  deleteCustomer,
  registerHeartbeatToken,
} from "@/lib/data/customers";
import {
  listMyFavorites,
  listOrphanFavorites,
  listFavoritersOfCustomer,
  addFavoriteByRemoteId,
} from "@/lib/data/favorites";
import {
  listMyRecentSessions,
  listActiveSessions,
  startSession,
  endSession,
} from "@/lib/data/sessions";
import { assertEmailAvailable } from "@/lib/data/users";
import {
  tenants,
  users,
  customers,
  userFavorites,
  supportSessions,
} from "@/lib/schema";

// ★ 테넌트(대리점) 간 데이터 격리 검증.
//   두 회사 A/B 의 거래처·즐겨찾기·사용자·세션이 절대 서로에게 새면 안 된다.
//   전략: 모든 조회에 A/B 데이터를 섞어 심어두고, tenantId=A 로 부른 결과가 B 를
//   한 톨도 포함하지 않는지 본다. 또 DB 레벨 방어선(마이그011 remote_id 전역 unique,
//   마이그012 email lower() 전역 unique)이 실제로 막는지 raw insert 로 확인한다.

// ── 인라인 시드 헬퍼 (기존 테스트 패턴 그대로) ──
async function makeTenant(slug: string): Promise<string> {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  return t.id;
}

async function makeUser(tenantId: string, email: string): Promise<string> {
  const db = testDb();
  const [u] = await db
    .insert(users)
    .values({ tenantId, email, passwordHash: "x", displayName: email })
    .returning({ id: users.id });
  return u.id;
}

async function makeCustomer(
  tenantId: string,
  name: string,
  remoteId: string | null,
): Promise<string> {
  const db = testDb();
  const [c] = await db
    .insert(customers)
    .values({ tenantId, name, remoteId })
    .returning({ id: customers.id });
  return c.id;
}

// 두 회사(A/B) 각각 사용자+거래처 한 벌씩 심는다.
async function seedTwoTenants() {
  const tA = await makeTenant("tenant-a");
  const tB = await makeTenant("tenant-b");
  const uA = await makeUser(tA, "changA@x.com");
  const uB = await makeUser(tB, "jaesungB@x.com");
  const cA = await makeCustomer(tA, "A상회", "GN10000001");
  const cB = await makeCustomer(tB, "B마트", "GN20000002");
  return { tA, tB, uA, uB, cA, cB };
}

describe("테넌트 격리 — 거래처 조회", () => {
  it("listCustomers(A) 는 B 거래처를 절대 포함하지 않는다", async () => {
    const { tA, tB } = await seedTwoTenants();
    const rowsA = await listCustomers(tA);
    const rowsB = await listCustomers(tB);
    expect(rowsA.map((r) => r.name)).toEqual(["A상회"]);
    expect(rowsB.map((r) => r.name)).toEqual(["B마트"]);
    // A 결과에 B 의 tenantId 가 섞이지 않았다.
    expect(rowsA.every((r) => r.tenantId === tA)).toBe(true);
  });

  it("getCustomer(B거래처id, A) 는 null — 남의 거래처 id 를 알아도 못 읽는다", async () => {
    const { tA, cB } = await seedTwoTenants();
    const stolen = await getCustomer(cB, tA);
    expect(stolen).toBeNull();
  });

  it("updateCustomer 는 tenantId 불일치면 무변경(null) 반환 — 남의 거래처 수정 불가", async () => {
    const db = testDb();
    const { tA, cB } = await seedTwoTenants();
    const res = await updateCustomer(
      cB,
      {
        name: "탈취됨",
        contactName: null,
        phone: null,
        address: null,
        remoteId: "GN20000002",
        accessPassword: null,
        notes: null,
      },
      { tenantId: tA }, // A 가 B 거래처 수정 시도
    );
    expect(res).toBeNull();
    // 실제로 B 거래처 이름이 안 바뀌었는지 확인.
    const [row] = await db.select().from(customers).where(eq(customers.id, cB));
    expect(row.name).toBe("B마트");
  });

  it("deleteCustomer 는 tenantId 불일치면 false — 남의 거래처 삭제 불가", async () => {
    const db = testDb();
    const { tA, cB } = await seedTwoTenants();
    const ok = await deleteCustomer(cB, { tenantId: tA });
    expect(ok).toBe(false);
    const rows = await db.select().from(customers).where(eq(customers.id, cB));
    expect(rows.length).toBe(1); // 여전히 존재
  });
});

describe("테넌트 격리 — 즐겨찾기 조회", () => {
  it("listMyFavorites(A유저, A) 는 B 유저 즐겨찾기를 안 준다", async () => {
    const { tA, tB, uA, uB } = await seedTwoTenants();
    await addFavoriteByRemoteId(uA, "GN10000001", tA);
    await addFavoriteByRemoteId(uB, "GN20000002", tB);
    const favA = await listMyFavorites(uA, tA);
    expect(favA.map((f) => f.remoteId)).toEqual(["GN10000001"]);
  });

  it("listOrphanFavorites(A) 는 B 의 orphan 후보를 포함하지 않는다", async () => {
    const { tA, tB, uA, uB } = await seedTwoTenants();
    // customers 에 없는 remote_id 로 즐겨찾기 = orphan 후보
    await addFavoriteByRemoteId(uA, "ORPHAN-A", tA);
    await addFavoriteByRemoteId(uB, "ORPHAN-B", tB);
    const orphansA = await listOrphanFavorites(tA);
    expect(orphansA.map((o) => o.remoteId)).toEqual(["ORPHAN-A"]);
  });

  it("listFavoritersOfCustomer(B거래처id, A) 는 빈 배열 — id 를 알아도 새지 않는다", async () => {
    const { tA, tB, uB, cB } = await seedTwoTenants();
    await addFavoriteByRemoteId(uB, "GN20000002", tB); // B 유저가 B 거래처 즐겨찾기
    // A 가 B 거래처 id + 자기 tenantId 로 조회 → 격리로 빈 배열
    const leaked = await listFavoritersOfCustomer(cB, tA);
    expect(leaked).toEqual([]);
    // 올바른 tenantId(B)로는 정상 조회됨(격리가 과하지 않음을 대조 확인).
    const proper = await listFavoritersOfCustomer(cB, tB);
    expect(proper.map((f) => f.userId)).toEqual([uB]);
  });
});

describe("테넌트 격리 — 세션 조회/종료", () => {
  it("listMyRecentSessions / listActiveSessions 는 B 세션을 안 준다", async () => {
    const { tA, tB, uA, uB, cA, cB } = await seedTwoTenants();
    await startSession({ tenantId: tA, operatorId: uA, customerId: cA, remoteId: "GN10000001" });
    await startSession({ tenantId: tB, operatorId: uB, customerId: cB, remoteId: "GN20000002" });

    const recentA = await listMyRecentSessions(uA, tA);
    expect(recentA.length).toBe(1);
    expect(recentA[0].session.tenantId).toBe(tA);

    const activeA = await listActiveSessions(tA);
    expect(activeA.length).toBe(1);
    expect(activeA.every((r) => r.session.tenantId === tA)).toBe(true);
  });

  it("endSession(B세션id, A) 는 무변경 — 남의 세션을 못 끝낸다", async () => {
    const db = testDb();
    const { tA, tB, uB, cB } = await seedTwoTenants();
    const s = await startSession({
      tenantId: tB,
      operatorId: uB,
      customerId: cB,
      remoteId: "GN20000002",
    });
    // A 가 B 세션을 끝내려 시도.
    await endSession(s.id, tA);
    const [row] = await db
      .select()
      .from(supportSessions)
      .where(eq(supportSessions.id, s.id));
    expect(row.endedAt).toBeNull(); // 여전히 활성 — 격리로 무시됨
  });
});

describe("마이그011 — remote_id 전역 unique (cross-tenant 탈취 차단)", () => {
  it("다른 tenant 가 같은 remote_id 를 raw insert 하면 unique 위반", async () => {
    const db = testDb();
    const tA = await makeTenant("t-a");
    const tB = await makeTenant("t-b");
    await makeCustomer(tA, "먼저", "GN55550000");
    // B 가 같은 remote_id 를 넣으려 하면 DB 가 막는다 (uq_customers_remote_id).
    await expect(
      db.insert(customers).values({ tenantId: tB, name: "나중", remoteId: "GN55550000" }),
    ).rejects.toThrow();
  });

  it("같은 tenant 안에서도 remote_id 중복 insert 는 막힌다", async () => {
    const db = testDb();
    const tA = await makeTenant("t-a");
    await makeCustomer(tA, "하나", "GN66660000");
    await expect(
      db.insert(customers).values({ tenantId: tA, name: "둘", remoteId: "GN66660000" }),
    ).rejects.toThrow();
  });

  it("NULL/빈 remote_id 는 partial index 라 여러 tenant 가 공유 가능(placeholder 충돌 없음)", async () => {
    const db = testDb();
    const tA = await makeTenant("t-a");
    const tB = await makeTenant("t-b");
    // NULL 여러 개 (거래처 ID 미등록 placeholder) 는 unique 에서 빠진다.
    await makeCustomer(tA, "미등록1", null);
    await makeCustomer(tA, "미등록2", null);
    await expect(
      db.insert(customers).values({ tenantId: tB, name: "미등록3", remoteId: "" }),
    ).resolves.toBeDefined();
    const all = await db.select().from(customers);
    expect(all.length).toBe(3);
  });
});

describe("마이그012 — users.email lower() 전역 unique (C1 계정충돌 방어선)", () => {
  it("두 tenant 가 같은 email 을 raw insert 하면 unique 위반", async () => {
    const db = testDb();
    const tA = await makeTenant("t-a");
    const tB = await makeTenant("t-b");
    await db
      .insert(users)
      .values({ tenantId: tA, email: "chang@x.com", passwordHash: "x", displayName: "A" });
    await expect(
      db
        .insert(users)
        .values({ tenantId: tB, email: "chang@x.com", passwordHash: "x", displayName: "B" }),
    ).rejects.toThrow();
  });

  it("대소문자만 다른 email 도 막힌다 (lower(email) 인덱스) — 'Chang' vs 'chang'", async () => {
    const db = testDb();
    const tA = await makeTenant("t-a");
    const tB = await makeTenant("t-b");
    await db
      .insert(users)
      .values({ tenantId: tA, email: "Chang@X.com", passwordHash: "x", displayName: "A" });
    await expect(
      db
        .insert(users)
        .values({ tenantId: tB, email: "chang@x.com", passwordHash: "x", displayName: "B" }),
    ).rejects.toThrow();
  });

  it("assertEmailAvailable 는 대소문자 무시하고 타 tenant 중복을 잡아 읽기쉬운 에러를 던진다", async () => {
    const tA = await makeTenant("t-a");
    await makeUser(tA, "owner@shop.com");
    // 다른 tenant 가 대문자로 같은 아이디를 만들려 해도 사전검사가 막는다.
    await expect(assertEmailAvailable("OWNER@shop.com")).rejects.toThrow(
      /이미 사용 중인 아이디/,
    );
  });

  it("완전히 다른 email 은 통과 — 방어가 과하지 않다", async () => {
    const tA = await makeTenant("t-a");
    await makeUser(tA, "owner@shop.com");
    await expect(assertEmailAvailable("other@shop.com")).resolves.toBeUndefined();
  });
});

// ── H2 봉인(2026-07-07): heartbeat-token 발급이 이제 tenant enroll-key 인증을 요구 ──
describe("경계 — heartbeat-token 발급 tenant 스코프 (H2 봉인)", () => {
  it("registerHeartbeatToken 에 남의 tenantId 를 넘기면 null — cross-tenant 회전 차단", async () => {
    // 라우트는 enroll-key 인증 후 그 tenantId 로 스코프해 호출한다. remote_id 를 알아도
    // 자기 tenant 소속이 아니면 0행 → null. (옛날엔 remote_id 만으로 무인증 발급됐다.)
    const owner = await makeTenant("t-owner");
    const attacker = await makeTenant("t-attacker");
    await makeCustomer(owner, "소유거래처", "GN99990000");
    expect(await registerHeartbeatToken("GN99990000", attacker)).toBeNull();
    // 소유 tenant 로 스코프하면 정상 발급.
    expect(await registerHeartbeatToken("GN99990000", owner)).not.toBeNull();
  });

  it("존재하지 않는 remote_id 는 null (없는 거래처엔 토큰 안 준다)", async () => {
    const t = await makeTenant("t-x");
    const token = await registerHeartbeatToken("NO-SUCH-ID", t);
    expect(token).toBeNull();
  });
});
