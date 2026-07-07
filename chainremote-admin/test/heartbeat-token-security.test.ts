import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { registerHeartbeatToken, recordHeartbeat } from "@/lib/data/customers";
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
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) ★H2 구멍 — 무인증 토큰 발급/회전 = 토큰 탈취 & 정당 에이전트 축출
//
//   registerHeartbeatToken 은 remote_id 만 알면 (아무 인증 없이) 유효 토큰을 새로
//   찍어준다. route(register-heartbeat-token/route.ts)도 body.remoteId 만 받고 인증
//   미들웨어가 없다. 즉 공격자가 대상 remote_id 만 알면:
//     ① 유효 토큰을 받아 그 거래처의 상태/버전을 위조 보고할 수 있고
//     ② 발급이 곧 "회전"이라 정당 에이전트의 기존 토큰을 무효화(축출/DoS)한다.
//   아래 두 테스트는 이 취약한 "현재 동작"을 못박아 둔다(회귀 감시). 원하는 안전한
//   동작은 바로 아래 it.todo 로 남겼다. (반환값 vulnerabilities 에 별도 보고.)
// ─────────────────────────────────────────────────────────────────────────────
describe("★H2 취약점 — 무인증 heartbeat 토큰 발급/회전 (현재 동작 문서화)", () => {
  it("[취약] 인증 없이 remote_id 만으로 유효 토큰을 받아 위조 보고가 통한다", async () => {
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");

    // 공격자: 아무 세션/토큰/tenant 증명 없이 remote_id 만으로 발급 호출
    const attackerToken = await registerHeartbeatToken("77138120");
    expect(attackerToken).toBeTruthy();

    // 그 토큰으로 위조 버전을 보고 → 서버가 받아들인다(200 상당)
    const ok = await recordHeartbeat("77138120", attackerToken!, "9.9.9-fake");
    expect(ok).toBe(true); // ← 현재는 막지 못한다 (취약)
  });

  it("[취약] 재발급이 곧 회전이라 정당 에이전트의 기존 토큰이 무효화된다(축출)", async () => {
    const tid = await makeTenant("betapos");
    await makeCustomer(tid, "부엌", "77138120");

    // 정당 에이전트가 먼저 토큰을 받는다
    const legitToken = await registerHeartbeatToken("77138120");
    expect(await recordHeartbeat("77138120", legitToken!, "1.4.49")).toBe(true);

    // 공격자가 같은 remote_id 로 재발급 → 토큰 회전
    const attackerToken = await registerHeartbeatToken("77138120");
    expect(attackerToken).not.toBe(legitToken);

    // ★ 정당 에이전트의 기존 토큰은 이제 죽었다 (heartbeat 403 → 축출/DoS)
    expect(await recordHeartbeat("77138120", legitToken!, "1.4.49")).toBe(false);
    // 공격자 토큰만 살아있다
    expect(await recordHeartbeat("77138120", attackerToken!, "9.9.9-fake")).toBe(true);
  });

  // ── 원하는 안전한 동작(아직 미구현) ──────────────────────────────────────
  // H2 를 막으려면 데이터 레이어/route 가 인증(tenant enroll-key 또는 세션)을 요구해야
  // 하고, 발급을 "이미 토큰 있는 거래처는 회전 금지(또는 소유 증명 필요)"로 좁혀야 한다.
  // 현재 registerHeartbeatToken(remoteId) 시그니처엔 인증 인자가 없어 표현 불가 → todo.
  it.todo(
    "토큰 발급은 인증(tenant enroll-key/세션)을 요구해야 한다 — remote_id 만으로 불가",
  );
  it.todo(
    "이미 유효 토큰이 있는 거래처는 무인증 재발급으로 회전되지 않아야 한다(정당 에이전트 축출 방지)",
  );
});
