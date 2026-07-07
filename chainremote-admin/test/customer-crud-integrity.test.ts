import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  createCustomer,
  importPeer,
  enrollCustomer,
  confirmEnrollment,
  confirmEnrollmentByRemoteId,
  registerHeartbeatToken,
  deleteCustomer,
} from "@/lib/data/customers";
import { jsonError } from "@/lib/api-auth";
import {
  tenants,
  users,
  customers,
  userFavorites,
  pendingUpdates,
} from "@/lib/schema";

// ★ customer-crud-integrity — 거래처 레코드 무결성.
// 검증 축: (a) enroll 동시 레이스 수렴  (b) remote_id 전역 unique 위반 → 409 변환(M8)
//          (c) pending 후보 확정 상태전이  (d) 삭제 시 FK on-delete(cascade/set null)
// 실 마이그레이션 18개가 적용된 pglite 위에서 SQL 제약(uq_customers_remote_id, FK)까지 진짜 검증.

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

// createCustomer 가 요구하는 전체 CustomerFields 를 최소값으로 채운다.
function fields(name: string, remoteId: string | null) {
  return {
    name,
    contactName: null,
    phone: null,
    address: null,
    remoteId,
    accessPassword: null,
    notes: null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
describe("(a) enrollCustomer 동시 레이스 — 중복 없이 토큰 회전으로 수렴", () => {
  it("같은 remote_id 를 거의 동시에 두 번 enroll → 1 레코드 + created=true 정확히 1건", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");

    // 두 요청을 동시에 던진다(Promise.all). 진짜로 인터리브되든(catch 경로) 직렬화되든
    //   불변식은 같다: 레코드 1개, created=true 정확히 1건, created=false 정확히 1건.
    const [r1, r2] = await Promise.all([
      enrollCustomer({ remoteId: "AB12341234", name: "레이스거래처" }, { tenantId: tid }),
      enrollCustomer({ remoteId: "AB12341234", name: "레이스거래처" }, { tenantId: tid }),
    ]);

    expect(r1).not.toBe("cross_tenant");
    expect(r2).not.toBe("cross_tenant");
    if (r1 === "cross_tenant" || r2 === "cross_tenant") return; // 타입 좁히기

    // ★ 중복 레코드가 안 생겼다 (uq_customers_remote_id + catch-재조회 수렴).
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, "AB12341234"));
    expect(rows.length).toBe(1);

    // 정확히 한 요청만 새 레코드를 만들었다.
    const createdCount = [r1.created, r2.created].filter(Boolean).length;
    expect(createdCount).toBe(1);

    // 두 요청 모두 유효한(서로 다른) 토큰을 회전받았다 — 나중 요청도 stuck 되지 않는다.
    expect(r1.token).toBeTruthy();
    expect(r2.token).toBeTruthy();
    expect(r1.token).not.toBe(r2.token);
  });

  it("순차 재enroll 도 같은 수렴 — 두 번째는 created=false, 토큰만 회전", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");
    const first = await enrollCustomer({ remoteId: "AB55556666" }, { tenantId: tid });
    const second = await enrollCustomer({ remoteId: "AB55556666" }, { tenantId: tid });
    if (first === "cross_tenant" || second === "cross_tenant") throw new Error("unexpected");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.token).not.toBe(first.token);
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, "AB55556666"));
    expect(rows.length).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("(b) remote_id 전역 partial-unique 위반 — 라우트 409 변환(M8) 은 실제로 깨져 있다", () => {
  // ★★ 취약점(HIGH): jsonError 의 M8 409 변환은 실 드라이버에서 동작하지 않는다.
  //    drizzle 0.45.2 는 DB 에러를 DrizzleQueryError 로 감싸 e.message = "Failed query: insert ..."
  //    로 바꾸고, 진짜 "duplicate key value violates unique constraint uq_customers_remote_id"
  //    문구는 e.cause.message 로 내려보낸다. 그런데 jsonError 는 e.message 만 검사한다:
  //      /duplicate key|unique/i.test(e.message)  ← wrapper 엔 그 단어가 없어 false → 500 로 낙하.
  //    (wrapper 의 컬럼목록에 "remote_id" 는 있어 2번째 정규식만 통과, 그래도 AND 라 무효.)
  //    이 wrapping 은 pg-core 레벨이라 프로덕션 node-postgres 에서도 동일 → 거래처가 다른
  //    거래처와 같은 원격 ID 를 등록하면 데스크톱 앱은 친화적 409 대신 raw 500 을 받는다.
  //  아래 테스트는 그 '현재(깨진) 동작'을 못박는다. 안전한 동작은 it.todo.
  it("[수정됨] createCustomer 중복 remote_id → jsonError 가 cause 체인을 보고 409 를 낸다", async () => {
    const t1 = await makeTenant("tenant-a");
    const u1 = await makeUser(t1, "a");
    const t2 = await makeTenant("tenant-b");
    const u2 = await makeUser(t2, "b");

    await createCustomer(fields("A거래처", "GN10001000"), {
      tenantId: t1,
      assignedUserId: u1,
    });

    // createCustomer 는 unique 위반을 잡지 않고 raw 로 throw 한다(enrollCustomer 와 달리 수렴 없음).
    let thrown: unknown;
    try {
      await createCustomer(fields("B거래처(중복ID)", "GN10001000"), {
        tenantId: t2,
        assignedUserId: u2,
      });
      throw new Error("SHOULD_HAVE_THROWN");
    } catch (e) {
      thrown = e;
      if (e instanceof Error && e.message === "SHOULD_HAVE_THROWN") throw e;
    }

    // DB 는 확실히 막았다 — 진짜 제약명이 cause 에 있다.
    const cause = (thrown as { cause?: Error }).cause;
    expect(cause?.message).toMatch(/duplicate key value violates unique constraint/i);
    expect(cause?.message).toMatch(/uq_customers_remote_id/);
    // 그러나 wrapper 인 e.message 엔 "duplicate/unique" 가 없다 → M8 매칭 실패.
    expect((thrown as Error).message).not.toMatch(/duplicate key|unique/i);

    // ★ 수정 후: jsonError 가 e.cause 체인까지 훑어 409(친화적 메시지)를 낸다.
    const res = jsonError(thrown);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/이미 등록된 원격 ID/);

    // 중복 삽입은 실제로 안 됐다 — 전역에 그 remote_id 는 1행뿐(무결성 자체는 DB 가 지킴).
    const db = testDb();
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, "GN10001000"));
    expect(rows.length).toBe(1);
  });

  it("[참고] jsonError 는 e.message 에 문구가 있을 때만 409 로 바꾼다 (문자열 매칭 결합)", async () => {
    // 실 드라이버는 wrapper 라 이 조건을 만족 못 하지만, 매칭 로직 자체는 이렇게 동작한다는 증거.
    const fake = new Error(
      'duplicate key value violates unique constraint "uq_customers_remote_id"',
    );
    const res = jsonError(fake);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/이미 등록된 원격 ID/);
  });

  it("같은 tenant 안에서 같은 remote_id 두 번 createCustomer 도 DB 가 막는다", async () => {
    const t1 = await makeTenant("tenant-a");
    const u1 = await makeUser(t1, "a");
    await createCustomer(fields("첫 등록", "GN20002000"), {
      tenantId: t1,
      assignedUserId: u1,
    });
    await expect(
      createCustomer(fields("중복 등록", "GN20002000"), {
        tenantId: t1,
        assignedUserId: u1,
      }),
    ).rejects.toThrow();
  });

  // (위 '[수정됨]' 테스트가 실 드라이버 wrapper 에러도 409 로 변환됨을 검증 — jsonError 가
  //  e.cause 체인을 훑도록 고침. 옛 it.todo 는 이제 실제 통과 테스트로 승격됨.)
});

// ───────────────────────────────────────────────────────────────────────────
describe("(c) pending 후보 확정 — enroll_status 상태전이", () => {
  async function seedPending(tenantId: string, remoteId: string): Promise<string> {
    const db = testDb();
    const [row] = await db
      .insert(customers)
      .values({ tenantId, name: `후보 ${remoteId}`, remoteId, enrollStatus: "pending" })
      .returning({ id: customers.id });
    return row.id;
  }

  async function statusOf(id: string): Promise<string | undefined> {
    const db = testDb();
    const [row] = await db
      .select({ s: customers.enrollStatus })
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);
    return row?.s;
  }

  it("confirmEnrollment(id): pending→active, 반환 true; 두 번째 호출은 무변경 false", async () => {
    const tid = await makeTenant("betapos");
    const id = await seedPending(tid, "GN30003000");
    expect(await confirmEnrollment(id, { tenantId: tid })).toBe(true);
    expect(await statusOf(id)).toBe("active");
    // 이미 active — 무변경.
    expect(await confirmEnrollment(id, { tenantId: tid })).toBe(false);
  });

  it("confirmEnrollmentByRemoteId: pending→active, 반환 true", async () => {
    const tid = await makeTenant("betapos");
    const id = await seedPending(tid, "GN30004000");
    expect(await confirmEnrollmentByRemoteId("GN30004000", { tenantId: tid })).toBe(true);
    expect(await statusOf(id)).toBe("active");
  });

  it("다른 tenant 는 남의 pending 후보를 확정 못 한다 (무변경 false, 상태 유지)", async () => {
    const owner = await makeTenant("owner");
    const attacker = await makeTenant("attacker");
    const id = await seedPending(owner, "GN30005000");
    // 공격 tenant 로 confirm 시도 — 두 경로 다 tenantId 게이트로 막힌다.
    expect(await confirmEnrollment(id, { tenantId: attacker })).toBe(false);
    expect(
      await confirmEnrollmentByRemoteId("GN30005000", { tenantId: attacker }),
    ).toBe(false);
    // ★ 여전히 pending — 남이 확정하지 못했다.
    expect(await statusOf(id)).toBe("pending");
  });

  it("enrollCustomer 로 만든 신규 거래처는 곧바로 active (pending 후보 단계 없음, 2026-06-29 결정)", async () => {
    const tid = await makeTenant("betapos");
    const r = await enrollCustomer({ remoteId: "GN30006000", name: "즉시확정" }, { tenantId: tid });
    if (r === "cross_tenant") throw new Error("unexpected");
    const db = testDb();
    const [row] = await db
      .select({ s: customers.enrollStatus })
      .from(customers)
      .where(eq(customers.remoteId, "GN30006000"))
      .limit(1);
    expect(row.s).toBe("active");
    // active 라서 확정할 pending 이 없다 → confirm 은 무변경 false.
    expect(await confirmEnrollmentByRemoteId("GN30006000", { tenantId: tid })).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("(d) 거래처 삭제 — 관련 레코드 FK on-delete 동작", () => {
  // ★★ 취약점(MEDIUM, 스키마↔마이그레이션 불일치): lib/schema.ts 는 user_favorites.customer_id 를
  //    references(..., { onDelete: "set null" }) 로 선언한다. 그러나 실 DB 제약은 마이그 005 의
  //    "customer_id ... REFERENCES customers(id) ON DELETE CASCADE" 이고, 마이그 008 은 컬럼을
  //    nullable 로만 바꿨을 뿐 FK 규칙은 안 건드렸다. 즉 실제 동작은 CASCADE 다.
  //    결과: 거래처를 삭제하면 그 머신을 즐겨찾기한 '모든 직원의 즐겨찾기 행이 통째로 삭제'된다.
  //    설계 의도(favorites.ts 주석: 삭제 후 orphan '신규 거래처 후보' 로 복귀, SET NULL 로 remote_id
  //    보존)와 정반대의 조용한 데이터 손실. 드리즐 스키마만 읽고 set-null 을 가정하는 코드는 틀린다.
  it("[수정됨/마이그019] 삭제 시 user_favorites.customer_id 가 SET NULL — 즐겨찾기 행 보존", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");
    const uid = await makeUser(tid, "chang");
    const [cust] = await db
      .insert(customers)
      .values({ tenantId: tid, name: "부엌", remoteId: "GN40004000" })
      .returning({ id: customers.id });
    // 이 거래처를 즐겨찾기(customer_id 채워짐).
    await db.insert(userFavorites).values({
      userId: uid,
      remoteId: "GN40004000",
      customerId: cust.id,
      tenantId: tid,
    });

    expect(await deleteCustomer(cust.id, { tenantId: tid })).toBe(true);

    const favs = await db
      .select()
      .from(userFavorites)
      .where(and(eq(userFavorites.userId, uid), eq(userFavorites.remoteId, "GN40004000")));
    // ★ 마이그019 로 FK=SET NULL: 즐겨찾기 행은 살아남고(remote_id 유지 → orphan 후보 복귀),
    //   customer_id 만 NULL. 스키마 선언(set null)과 일치. 직원 즐겨찾기 조용한 삭제 없음.
    expect(favs.length).toBe(1);
    expect(favs[0].customerId).toBeNull();
    expect(favs[0].remoteId).toBe("GN40004000");
  });

  it("삭제 시 pending_updates 는 CASCADE 로 함께 지워진다(고아 큐 미방지)", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");
    const uid = await makeUser(tid, "chang");
    const [cust] = await db
      .insert(customers)
      .values({ tenantId: tid, name: "포스", remoteId: "GN50005000" })
      .returning({ id: customers.id });
    // 이 거래처에 업데이트 푸시 큐 1행.
    await db.insert(pendingUpdates).values({
      tenantId: tid,
      customerId: cust.id,
      targetVersion: "1.4.49",
      assetUrl: "https://example/agent.exe",
      assetSha256: "deadbeef",
      assetSize: 1234,
      requestedBy: uid,
    });

    expect(await deleteCustomer(cust.id, { tenantId: tid })).toBe(true);

    const pu = await db
      .select()
      .from(pendingUpdates)
      .where(eq(pendingUpdates.tenantId, tid));
    // ★ CASCADE — 거래처가 사라지면 그 큐도 사라진다(dangling FK 방지).
    expect(pu.length).toBe(0);
  });

  it("삭제는 tenant 격리 — 다른 tenant 는 남의 거래처를 못 지운다(false, 레코드 유지)", async () => {
    const db = testDb();
    const owner = await makeTenant("owner");
    const attacker = await makeTenant("attacker");
    const [cust] = await db
      .insert(customers)
      .values({ tenantId: owner, name: "타사거래처", remoteId: "GN60006000" })
      .returning({ id: customers.id });
    expect(await deleteCustomer(cust.id, { tenantId: attacker })).toBe(false);
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.id, cust.id));
    expect(rows.length).toBe(1); // 안 지워졌다
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 취약점 문서화 — 현재(취약한) 동작을 통과 테스트로 못박고, 원하는 안전 동작은 it.todo.
describe("(e) importPeer — 레이스/중복 미방어 (enrollCustomer 와 비대칭)", () => {
  it("[수정됨] 같은 tenant 중복 remote_id importPeer 는 raw throw 대신 기존 행으로 수렴", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");
    const uid = await makeUser(tid, "chang");
    const first = await importPeer({ remoteId: "GN70007000", name: "봉스푸드" }, {
      tenantId: tid,
      assignedUserId: uid,
    });
    // ★ 같은 remote_id 재importPeer — enrollCustomer 처럼 catch-재조회로 수렴(기존 행 반환).
    const second = await importPeer({ remoteId: "GN70007000", name: "중복후보" }, {
      tenantId: tid,
      assignedUserId: uid,
    });
    expect(second.id).toBe(first.id); // 같은 레코드로 수렴, raw throw 없음
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, "GN70007000"));
    expect(rows.length).toBe(1); // 중복 레코드 없음
  });

  it("[수정됨] 타 tenant 소유 remote_id importPeer 는 여전히 throw(격리 유지)", async () => {
    const other = await makeTenant("other");
    const uOther = await makeUser(other, "o");
    await importPeer({ remoteId: "GN80008000", name: "타사거래처" }, {
      tenantId: other,
      assignedUserId: uOther,
    });
    const mine = await makeTenant("mine");
    const uMine = await makeUser(mine, "m");
    // 타 tenant 가 쓰는 remote_id 는 수렴 대상 아님 → throw → jsonError 가 409 로 변환.
    await expect(
      importPeer({ remoteId: "GN80008000", name: "가로채기시도" }, {
        tenantId: mine,
        assignedUserId: uMine,
      }),
    ).rejects.toThrow();
  });
});

describe("(f) registerHeartbeatToken — tenant 스코프(H2 봉인)", () => {
  it("[수정됨] tenantId 로 스코프하면 남의 tenant 거래처 토큰은 회전 못 한다(null)", async () => {
    const db = testDb();
    const victim = await makeTenant("victim");
    const attacker = await makeTenant("attacker");
    const [cust] = await db
      .insert(customers)
      .values({
        tenantId: victim,
        name: "피해거래처",
        remoteId: "GN80008000",
        heartbeatToken: "old-hash",
      })
      .returning({ id: customers.id });

    // ★ 라우트는 이제 enroll-key 인증 후 그 tenantId 로 스코프해 호출한다. 공격자 tenant 로
    //    스코프하면 remote_id 가 그 tenant 소유가 아니라 0행 → null. 남의 토큰 회전 불가.
    expect(await registerHeartbeatToken("GN80008000", attacker)).toBeNull();
    // 피해자(소유) tenant 의 토큰 해시는 그대로(안 바뀜).
    const [after] = await db
      .select({ h: customers.heartbeatToken })
      .from(customers)
      .where(eq(customers.id, cust.id))
      .limit(1);
    expect(after.h).toBe("old-hash");
    // 진짜 소유 tenant 로 스코프하면 발급된다.
    expect(await registerHeartbeatToken("GN80008000", victim)).toBeTruthy();
  });

  it("미등록 remote_id 는 null 반환(있는 것만 회전)", async () => {
    const t = await makeTenant("t");
    expect(await registerHeartbeatToken("GN99999999", t)).toBeNull();
  });
});
