import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { registerHeartbeatToken, recordHeartbeat } from "@/lib/data/customers";
import { getOrCreateEnrollKey } from "@/lib/data/tenants";
import { POST as registerTokenPOST } from "@/app/api/customers/register-heartbeat-token/route";
import { hashHeartbeatToken } from "@/lib/heartbeat-token";
import { tenants, customers } from "@/lib/schema";

// ★ 코워크 검토 H2/H3 — 거래처 heartbeat 토큰 보안.
//
// 이 파일은 두 가지를 한다:
//   1) 실제로 튼튼한 방어(존재-거래처만 발급 / 해시 저장 / 토큰 대조)를 강하게 검증한다.
//   2) 일부러 열어둔 무인증 구멍(H2)의 "현재(취약한) 동작"을 통과 테스트로 문서화하고,
//      "원하는 안전한 동작"은 it.todo 로 남긴다. (소스는 절대 수정하지 않는다 — 테스트만.)

async function makeTenant(slug: string): Promise<string> {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  return t.id;
}

async function makeCustomer(
  tenantId: string,
  name: string,
  remoteId: string,
): Promise<string> {
  const db = testDb();
  const [c] = await db
    .insert(customers)
    .values({ tenantId, name, remoteId })
    .returning({ id: customers.id });
  return c.id;
}

async function readToken(remoteId: string): Promise<string | null> {
  const db = testDb();
  const [row] = await db
    .select({ token: customers.heartbeatToken })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return row?.token ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) registerHeartbeatToken 은 "존재하는 거래처"에만 발급 — 새 거래처 절대 안 만든다
// ─────────────────────────────────────────────────────────────────────────────
describe("registerHeartbeatToken — 존재 거래처만 발급", () => {
  it("등록된 remoteId 면 평문 토큰을 반환", async () => {
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");
    const token = await registerHeartbeatToken("77138120");
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
    // 64-hex 평문(발급 규격)
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("미등록/삭제된 remoteId 면 null — 그리고 새 거래처를 만들지 않는다", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120"); // 무관한 거래처 1개

    const before = await db.select().from(customers);
    const token = await registerHeartbeatToken("00000000"); // 존재 안 함
    expect(token).toBeNull();

    const after = await db.select().from(customers);
    // ★ 유령 거래처 생성 없음 — 행 수 그대로
    expect(after.length).toBe(before.length);
    expect(after.length).toBe(1);
    // 존재하지 않는 ID 로는 아무 행도 안 생겼다
    const ghost = after.find((r) => r.remoteId === "00000000");
    expect(ghost).toBeUndefined();
  });

  it("빈 remoteId 로는 아무 거래처도 안 잡히고 null (기존 행 토큰 오염 없음)", async () => {
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");
    const token = await registerHeartbeatToken("");
    expect(token).toBeNull();
    // 기존 거래처 토큰은 여전히 미발급(NULL)
    expect(await readToken("77138120")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) 토큰은 DB 에 해시로 저장 — 평문 컬럼값 아님
// ─────────────────────────────────────────────────────────────────────────────
describe("토큰은 해시로 저장 (평문 아님)", () => {
  it("발급 평문 != DB 컬럼값, 그리고 컬럼값 == sha256(평문)", async () => {
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");
    const plaintext = await registerHeartbeatToken("77138120");
    expect(plaintext).toBeTruthy();

    const stored = await readToken("77138120");
    expect(stored).toBeTruthy();
    // ★ 평문이 그대로 저장되면 안 된다 (DB 유출 시 원본 노출)
    expect(stored).not.toBe(plaintext);
    // ★ 해시 대조로만 매칭됨을 확인
    expect(stored).toBe(hashHeartbeatToken(plaintext!));
    // 저장값은 64-hex sha-256
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) recordHeartbeat 은 올바른 토큰만 200 — 틀린/빈 토큰이면 false + 상태 무변경
// ─────────────────────────────────────────────────────────────────────────────
describe("recordHeartbeat — 토큰 검증", () => {
  it("올바른 토큰이면 true, last_version/last_heartbeat 갱신", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");
    const token = await registerHeartbeatToken("77138120");

    const ok = await recordHeartbeat("77138120", token!, "1.4.49");
    expect(ok).toBe(true);

    const [row] = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, "77138120"));
    expect(row.lastVersion).toBe("1.4.49");
    expect(row.lastHeartbeatAt).toBeInstanceOf(Date);
  });

  it("틀린 토큰이면 false — last_version/last_heartbeat 안 바뀜", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");
    await registerHeartbeatToken("77138120");

    const ok = await recordHeartbeat("77138120", "deadbeef".repeat(8), "9.9.9");
    expect(ok).toBe(false);

    const [row] = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, "77138120"));
    // 갱신 전 상태 그대로
    expect(row.lastVersion).toBeNull();
    expect(row.lastHeartbeatAt).toBeNull();
  });

  it("빈 토큰이면 false — 토큰 미발급 거래처는 매칭 안 됨", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120"); // 토큰 미발급(heartbeatToken NULL)

    const ok = await recordHeartbeat("77138120", "", "9.9.9");
    expect(ok).toBe(false);

    const [row] = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, "77138120"));
    expect(row.lastVersion).toBeNull();
    expect(row.lastHeartbeatAt).toBeNull();
  });

  it("올바른 토큰이라도 remoteId 가 다르면 false (다른 거래처 상태 못 씀)", async () => {
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");
    await makeCustomer(tid, "카페", "88888888");
    const tokenForKitchen = await registerHeartbeatToken("77138120");

    // 부엌 토큰으로 카페 remoteId 를 보고하려는 시도 → 매칭 실패
    const ok = await recordHeartbeat("88888888", tokenForKitchen!, "1.4.49");
    expect(ok).toBe(false);
  });

  // ★ 앵커 비활성 회귀 가드 — recordHeartbeat 의 백필 봉인(customers.ts recordHeartbeat)을
  //   되돌려 재활성화하면 이 테스트가 red 가 된다. enroll-anchor.test.ts 가 enrollCustomer 쪽을
  //   지키고, 이 테스트가 recordHeartbeat 쪽을 지켜 대칭 가드를 완성한다(복제 POS 지문 오염 부활 차단).
  it("machine_uuid 앵커 비활성: recordHeartbeat 에 지문을 넘겨도 machine_uuid 는 null 유지", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");
    const token = await registerHeartbeatToken("77138120");

    // 프로덕션 heartbeat 라우트는 매 tick 4번째 인자로 지문을 넘긴다. 복제 POS 이미지는 같은
    //   지문을 공유하므로, 저장하면 서로 다른 기계가 같은 machine_uuid 를 갖고 enroll 앵커가
    //   남의 레코드를 가로챈다. 따라서 지문을 넘겨도 절대 저장(백필)하면 안 된다.
    const ok = await recordHeartbeat("77138120", token!, "1.4.49", "SHARED-FP");
    expect(ok).toBe(true); // heartbeat 자체는 정상 기록

    const [row] = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, "77138120"));
    expect(row.machineUuid).toBeNull(); // ← 지문 저장 봉인 확인
    expect(row.lastVersion).toBe("1.4.49"); // 버전은 갱신됨(heartbeat 정상)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) ★H2 봉인(2026-07-07) — register-heartbeat-token 라우트가 이제 enroll-key 인증을
//   요구하고 그 tenant 로 스코프한다. 옛날엔 remote_id 만으로 무인증 발급/회전이 돼
//   ① 상태 위조 ② 정당 에이전트 축출(DoS)이 가능했다. 이제 tenant enroll-key 없이는 토큰을
//   못 받는다. (데이터 레이어 registerHeartbeatToken 은 tenantId 옵션으로 스코프 — 라우트가
//   항상 넘긴다. tenantId 없는 호출은 내부용 하위호환이고 어떤 라우트도 무인증 노출 안 함.)
// ─────────────────────────────────────────────────────────────────────────────
describe("★H2 봉인 — register-heartbeat-token 라우트 enroll-key 인증 요구", () => {
  it("enroll-key 없이 remote_id 만으로는 401(무인증 발급 봉인)", async () => {
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");
    const req = new Request("http://t/api/customers/register-heartbeat-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ remoteId: "77138120" }), // 키 없음
    });
    const res = await registerTokenPOST(req);
    expect(res.status).toBe(401); // remote_id 만으론 토큰 못 받음
  });

  it("틀린 enroll-key 는 403(tenant 인증 실패)", async () => {
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");
    const req = new Request("http://t/api/customers/register-heartbeat-token", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
      body: JSON.stringify({ remoteId: "77138120", tenantSlug: "betapos", enrollKey: "WRONG" }),
    });
    const res = await registerTokenPOST(req);
    expect(res.status).toBe(403);
  });

  it("올바른 enroll-key + 그 tenant 거래처면 200 토큰 발급", async () => {
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");
    const key = await getOrCreateEnrollKey(tid); // tenants.enroll_secret_hash 세팅
    const req = new Request("http://t/api/customers/register-heartbeat-token", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "8.8.8.8" },
      body: JSON.stringify({ remoteId: "77138120", tenantSlug: "betapos", enrollKey: key }),
    });
    const res = await registerTokenPOST(req);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { token: string };
    expect(j.token).toBeTruthy();
    // 발급받은 토큰으로 heartbeat 가 실제 통한다.
    expect(await recordHeartbeat("77138120", j.token, "1.4.49")).toBe(true);
  });

  it("올바른 tenant 인증이어도 남의 tenant 거래처 remote_id 는 409(스코프 격리)", async () => {
    const mine = await makeTenant("mine");
    const other = await makeTenant("other");
    await makeCustomer(other, "남의거래처", "GN80008000"); // 다른 tenant 소유
    const key = await getOrCreateEnrollKey(mine);
    const req = new Request("http://t/api/customers/register-heartbeat-token", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "7.7.7.7" },
      body: JSON.stringify({ remoteId: "GN80008000", tenantSlug: "mine", enrollKey: key }),
    });
    const res = await registerTokenPOST(req);
    expect(res.status).toBe(409); // 내 tenant 엔 그 거래처 없음 → 남의 토큰 회전 불가
  });

  it("데이터 레이어 스코프: registerHeartbeatToken(remoteId, 남의tenant) 는 null", async () => {
    const owner = await makeTenant("owner");
    const attacker = await makeTenant("attacker");
    await makeCustomer(owner, "피해거래처", "GN80008000");
    // 남의 tenantId 로 스코프하면 매칭 0행 → null (cross-tenant 회전 차단)
    expect(await registerHeartbeatToken("GN80008000", attacker)).toBeNull();
    // 진짜 소유 tenant 로 스코프하면 발급됨
    expect(await registerHeartbeatToken("GN80008000", owner)).toBeTruthy();
  });
});
