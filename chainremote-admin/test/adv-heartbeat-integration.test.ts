// 적대적 통합 테스트 — 단일 heartbeat 에 [토큰 롤링 + 디스크 보고 + 자동 롤아웃]이 동시에
// 올라탈 때의 상호작용을 노린다. 담당 영역: heartbeat-integration (갭 분석 HBI-1~11).
//
// 하네스 규약(기존 auto-rollout/heartbeat-arch/subscription-enforcement 테스트를 모방):
//   - 데이터 레이어 함수(recordHeartbeat 등)를 그대로 import → globalThis 주입 pglite 에 붙는다.
//   - 라우트 핸들러는 POST 를 import 후 new Request 로 직접 호출.
//   - agent-push-meta(getAgentPushMetaCached)만 vi.mock — 실제로는 NAS fetch 라 테스트에서 못 씀.
//     recordHeartbeat 이 이 값을 읽어 자동 롤아웃을 큐잉하므로 mock 으로 META 를 통제한다.
//
// 두 그룹으로 나뉜다:
//   (A) 회귀 가드 — 의도된 동작을 못박아 통과.
//   (B) 결함 후보 — 의도 vs 실제가 어긋나 실패 상태로 남긴다(억지 통과 X). Chang 승인 후 별도 수정.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { testDb } from "./helpers/db";
import {
  tenants,
  customers,
  users,
  pendingUpdates,
} from "@/lib/schema";

// ── agent-push-meta 모킹 (자동 롤아웃 META 통제) ──────────────────────────────
// vi.hoisted 로 holder 를 먼저 만들어 vi.mock 팩토리가 안전하게 참조하게 한다.
const hoisted = vi.hoisted(() => ({
  meta: null as
    | null
    | { version: string; url: string; sha256: string; size: number; autoRollout: boolean },
}));
vi.mock("@/lib/agent-push-meta", () => ({
  getAgentPushMetaCached: async () => hoisted.meta,
}));

// mock 이 걸린 뒤에 소비 모듈을 import (recordHeartbeat 이 getAgentPushMetaCached 를 씀).
import {
  recordHeartbeat,
  registerHeartbeatToken,
  requestCleanup,
} from "@/lib/data/customers";
import {
  pushToCustomer,
  getPendingForAgent,
} from "@/lib/data/pending-updates";
import { claimSeat, takeoverSeat } from "@/lib/data/active-sessions";
import { signApiToken } from "@/lib/api-auth";
import { POST as agentHeartbeatPOST } from "@/app/api/customers/heartbeat/route";
import { POST as authHeartbeatPOST } from "@/app/api/auth/heartbeat/route";

const GB = 1024 ** 3;
const META = {
  version: "1.4.62",
  url: "https://x/ChainRemote_Agent_Setup_v1.4.62.exe",
  sha256: "a".repeat(64),
  size: 35_000_000,
  autoRollout: true,
};

// 기본 META = 최신 1.4.62 + 자동 롤아웃 ON. 각 테스트가 필요하면 덮어쓴다(null/킬스위치 등).
beforeEach(() => {
  hoisted.meta = { ...META };
});

// ── 시드 헬퍼 ────────────────────────────────────────────────────────────────
async function makeTenant(
  slug: string,
  opts: { isActive?: boolean; subscriptionStatus?: "active" | "suspended" | "cancelled" } = {},
): Promise<string> {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({
      slug,
      displayName: slug,
      isActive: opts.isActive ?? true,
      subscriptionStatus: opts.subscriptionStatus ?? "active",
    })
    .returning({ id: tenants.id });
  return t.id;
}

async function makeCustomer(
  tenantId: string,
  name: string,
  remoteId: string,
  opts: { isInternal?: boolean; isActive?: boolean } = {},
): Promise<string> {
  const db = testDb();
  const [c] = await db
    .insert(customers)
    .values({
      tenantId,
      name,
      remoteId,
      isInternal: opts.isInternal ?? false,
      isActive: opts.isActive ?? true,
    })
    .returning({ id: customers.id });
  return c.id;
}

async function makeUser(tenantId: string, email: string, role = "owner"): Promise<string> {
  const db = testDb();
  const [u] = await db
    .insert(users)
    .values({ tenantId, email, passwordHash: "x", displayName: email, role: role as never, isActive: true })
    .returning({ id: users.id });
  return u.id;
}

async function issueToken(remoteId: string): Promise<string> {
  const t = await registerHeartbeatToken(remoteId);
  if (!t) throw new Error("토큰 발급 실패(시드 오류)");
  return t;
}

async function pendingRows(customerId: string) {
  return testDb()
    .select()
    .from(pendingUpdates)
    .where(eq(pendingUpdates.customerId, customerId));
}

async function readCustomer(remoteId: string) {
  const [r] = await testDb()
    .select()
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return r;
}

// 옛/근접만료 토큰을 임의 exp/jti 로 위조 — api-auth 의 signApiToken 은 24h 고정이라
//   needsTokenRefresh 트리거(<12h)를 만들 수 없다. jose 로 같은 issuer/audience/secret 서명.
async function signCustom(
  claims: { uid: string; email: string; displayName: string; role: string; tenantId: string },
  jti: string | undefined,
  expEpochSec: number,
): Promise<string> {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
  let b = new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("chainremote-admin")
    .setAudience("chainremote-desktop")
    .setIssuedAt()
    .setExpirationTime(expEpochSec);
  if (jti) b = b.setJti(jti);
  return b.sign(secret);
}

const NOW = () => Math.floor(Date.now() / 1000);

let ipN = 1;
function agentReq(
  body: unknown,
  opts: { token?: string | null; raw?: string } = {},
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `203.0.113.${ipN++}`,
  };
  if (opts.token !== undefined && opts.token !== null) headers["X-ChainRemote-Token"] = opts.token;
  return new Request("http://t/api/customers/heartbeat", {
    method: "POST",
    headers,
    body: opts.raw !== undefined ? opts.raw : JSON.stringify(body),
  });
}

function authReq(token: string, bodyStr = "{}"): Request {
  return new Request("http://t/api/auth/heartbeat", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: bodyStr,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// (A) 회귀 가드 — 의도된 동작 (통과)
// ═══════════════════════════════════════════════════════════════════════════
describe("HBI (A) 회귀 가드 — 의도된 통합 동작", () => {
  // HBI-4 — 인계당한(revoked) HQ heartbeat 는 롤링 토큰을 절대 안 준다.
  it("HBI-4: takeover 로 무효화된 옛 jti 의 근접만료 heartbeat → 401 revoked, 바디에 token 없음", async () => {
    const tid = await makeTenant("hbi4");
    const uid = await makeUser(tid, "hbi4@x", "owner");
    const jtiOld = randomUUID();
    const jtiNew = randomUUID();

    // 옛 기기가 좌석 확보 → 새 기기가 강제 종료(takeover)로 덮어씀 → 옛 jti 무효.
    expect((await claimSeat({ userId: uid, jti: jtiOld, deviceId: "OLD", deviceLabel: null, ip: null })).claimed).toBe(true);
    await takeoverSeat({ userId: uid, jti: jtiNew, deviceId: "NEW", deviceLabel: null, ip: null });

    // 옛 jti + 근접만료(11h<12h → 롤링 트리거) 토큰.
    const zombie = await signCustom(
      { uid, email: "hbi4@x", displayName: "hbi4", role: "owner", tenantId: tid },
      jtiOld,
      NOW() + 60 * 60 * 11,
    );
    const res = await authHeartbeatPOST(authReq(zombie));
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.revoked).toBe(true);
    // ★ 핵심: revoke 경로에서 refreshed 가 새면 좀비가 24h 재연장된다 — 절대 없어야.
    expect(j.token).toBeUndefined();
    expect("token" in j).toBe(false);
  });

  // HBI-5 — 한 heartbeat 에 디스크 + cleanupResult + 구버전이 동시에 실려도 전부 독립·원자 반영.
  it("HBI-5: 디스크·정리결과·버전 갱신 + 별도 롤아웃 큐잉이 서로를 삼키지 않는다", async () => {
    const tid = await makeTenant("hbi5");
    const cid = await makeCustomer(tid, "종합식자재", "HB55550005");
    const token = await issueToken("HB55550005");

    // 사전에 정리 명령 큐잉.
    expect(await requestCleanup("HB55550005", { tenantId: tid })).toBe(true);

    // 완료 시각(at)은 정리 요청보다 나중 — 정상 흐름(요청→실행→완료). 이래야 요청 큐가 비워진다.
    //   (disk-01: 완료가 요청보다 과거면 그건 stale 보고라 새 요청을 살려 둔다.)
    const cleanup = JSON.stringify({ freedBytes: 12 * GB, deleted: 42, skipped: 1, at: new Date(Date.now() + 1000).toISOString() });
    const ok = await recordHeartbeat(
      "HB55550005",
      token,
      "1.4.54", // 구버전 → 롤아웃 대상
      undefined,
      "x64",
      "Windows 10",
      "x64",
      { diskTotal: 120 * GB, diskFree: 4 * GB, tempBytes: 11 * GB, cleanupResult: cleanup },
    );
    expect(ok).toBe(true);

    const r = await readCustomer("HB55550005");
    // 버전 + 디스크 3필드 + os/arch 모두 반영.
    expect(r.lastVersion).toBe("1.4.54");
    expect(r.diskTotalBytes).toBe(120 * GB);
    expect(r.diskFreeBytes).toBe(4 * GB);
    expect(r.tempBytes).toBe(11 * GB);
    expect(r.arch).toBe("x64");
    expect(r.os).toBe("Windows 10");
    expect(r.osBits).toBe("x64");
    // cleanupResult 저장 + 요청 큐 클리어(재실행 방지).
    expect(r.cleanupResult).toBe(cleanup);
    expect(r.cleanupRequestedAt).toBeNull();

    // 그와 별개로 롤아웃 1행이 큐잉됨 — 정리/디스크 부수효과가 이를 방해하지 않았다.
    const p = await pendingRows(cid);
    expect(p.length).toBe(1);
    expect(p[0].targetVersion).toBe("1.4.62");
    expect(p[0].requestedBy).toBeNull(); // 자동 — 사람 아님
    expect(p[0].windowEndHour).toBe(24);
  });

  // HBI-6 — agent heartbeat 라우트 경계 (기존 테스트가 이 라우트를 안 다뤘다).
  describe("HBI-6: agent heartbeat 라우트 경계", () => {
    it("(a) X-ChainRemote-Token 헤더 없음 → 401", async () => {
      const res = await agentHeartbeatPOST(agentReq({ remoteId: "HB66660006", version: "1.4.60" }, { token: null }));
      expect(res.status).toBe(401);
    });

    it("(b) 토큰은 있으나 remoteId/version 누락 → 400", async () => {
      const res = await agentHeartbeatPOST(agentReq({}, { token: "any" }));
      expect(res.status).toBe(400);
    });

    it("(c) 잘못된 토큰 + 정상 필드 → 403", async () => {
      const tid = await makeTenant("hbi6c");
      await makeCustomer(tid, "복수점", "HB66660063");
      await issueToken("HB66660063"); // 진짜 토큰이 있지만
      const res = await agentHeartbeatPOST(
        agentReq({ remoteId: "HB66660063", version: "1.4.60" }, { token: "wrong-token-xyz" }),
      );
      expect(res.status).toBe(403);
    });

    it("(d) 정상 토큰 + cleanup 큐 존재 → 200 { ok:true, cleanup:<시각> }", async () => {
      const tid = await makeTenant("hbi6d");
      await makeCustomer(tid, "간이역", "HB66660064");
      const token = await issueToken("HB66660064");
      expect(await requestCleanup("HB66660064", { tenantId: tid })).toBe(true);
      const res = await agentHeartbeatPOST(agentReq({ remoteId: "HB66660064", version: "1.4.60" }, { token }));
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(j.ok).toBe(true);
      expect(typeof j.cleanup).toBe("string"); // ISO 시각 탑재
    });

    it("(e) 토큰 있고 바디가 비-JSON(빈/깨진) → 500 아니라 400 경로", async () => {
      const res = await agentHeartbeatPOST(agentReq(null, { token: "any", raw: "not json{" }));
      expect(res.status).toBe(400); // json 파싱 실패 → {} → remoteId 없음 → 400
    });

    it("(f) asNum: number 아닌 diskTotal/diskFree(문자열)은 undefined 로 강등 → 저장 안 됨", async () => {
      const tid = await makeTenant("hbi6f");
      await makeCustomer(tid, "월광", "HB66660065");
      const token = await issueToken("HB66660065");
      const res = await agentHeartbeatPOST(
        agentReq(
          { remoteId: "HB66660065", version: "1.4.60", diskTotal: "999", diskFree: "5" },
          { token },
        ),
      );
      expect(res.status).toBe(200);
      const r = await readCustomer("HB66660065");
      expect(r.diskTotalBytes).toBeNull(); // 문자열은 asNum 이 걸러 미저장
      expect(r.diskFreeBytes).toBeNull();
    });
  });

  // HBI-10 — tempBytes 단독(디스크쌍 없이)은 저장 안 됨 = 의도된 계약(회귀 가드).
  //   schema 주석: tempBytes 는 "여유 부족일 때만" 보내는 선택 필드로, 그때 디스크쌍도 함께 온다.
  //   diskSet 은 diskTotal·diskFree 가 둘 다 유효할 때만 만들어지고 tempBytes 는 그 안에 중첩된다.
  it("HBI-10: tempBytes 단독 보고는 무시된다(디스크쌍과 함께일 때만 저장) — 계약 못박기", async () => {
    const tid = await makeTenant("hbi10");
    await makeCustomer(tid, "부엌", "HB10100010");
    const token = await issueToken("HB10100010");
    const ok = await recordHeartbeat(
      "HB10100010", token, "1.4.59", undefined, undefined, undefined, undefined,
      { tempBytes: 5 * GB }, // 디스크쌍 없이 tempBytes 만
    );
    expect(ok).toBe(true);
    const r = await readCustomer("HB10100010");
    expect(r.tempBytes).toBeNull();
    expect(r.diskTotalBytes).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (B) 결함 후보 — 의도 vs 실제 불일치 (실패 상태로 남김)
//   이 describe 의 테스트는 "원하는 안전 동작"을 단언하며, 현재 소스는 그와 다르게 동작한다.
//   억지 통과(it.skip/반전) 시키지 않는다 — 실패가 곧 결함 신호다. Chang 승인 후 소스 수정.
// ═══════════════════════════════════════════════════════════════════════════
describe("HBI (B) 결함 후보 — 실패 예상", () => {
  // HBI-1 — 정지 tenant 에이전트의 heartbeat 가 자동 롤아웃을 큐잉한다.
  //   auth 표면은 requireApiAuth/heartbeat 가 isTenantActive 로 정지를 차단하지만(대칭),
  //   agent 표면(recordHeartbeat→autoQueueIfBehind)엔 tenant 게이트가 없다.
  it("HBI-1: 정지 tenant 도 자동 롤아웃 큐잉 — 최신 유지 정책(게이트 안 함)", async () => {
    const tid = await makeTenant("hbi1", { subscriptionStatus: "suspended" });
    const cid = await makeCustomer(tid, "정지매장", "HB11110001");
    const token = await issueToken("HB11110001");
    expect(await recordHeartbeat("HB11110001", token, "1.4.54")).toBe(true);
    // 정책(2026-07-21): 정지/미납도 에이전트 최신 유지는 계속(과금 무관). 롤아웃 1행 생성됨.
    expect((await pendingRows(cid)).length).toBe(1);
  });

  // HBI-2 — is_active=false 거래처가 auto-rollout 으로 큐잉됨.
  //   pushBulk 는 SQL 에서 c.is_active=true 로 명시 제외하는데, recordHeartbeat 의 반환행은
  //   {id,tenantId,isInternal} 뿐이라 autoQueueIfBehind 가 is_active 를 볼 수 없다.
  it("HBI-2: is_active=false 거래처도 auto-rollout 대상 — 최신 유지 정책", async () => {
    const tid = await makeTenant("hbi2");
    const cid = await makeCustomer(tid, "비활성거래처", "HB22220002", { isActive: false });
    const token = await issueToken("HB22220002");
    expect(await recordHeartbeat("HB22220002", token, "1.4.54")).toBe(true);
    // 정책(2026-07-21): 비활성 거래처도 자동 업뎃 유지(재개 시 이미 최신). 롤아웃 1행 생성됨.
    expect((await pendingRows(cid)).length).toBe(1);
  });

  // HBI-3 — 자동 롤아웃이 운영자의 의도적 수동 핀(다른/이전 버전)을 가려 무력화한다.
  it("HBI-3: 운영자 수동 핀(1.4.60)이 자동 롤아웃(1.4.62)에 가려지면 안 된다", async () => {
    const tid = await makeTenant("hbi3");
    const uid = await makeUser(tid, "hbi3@x", "owner");
    const cid = await makeCustomer(tid, "핫픽스매장", "HB33330003");
    const token = await issueToken("HB33330003");

    // 운영자가 1.4.60 핫픽스/롤백을 핀(먼저 걸림 → createdAt 을 60초 전으로 후퇴시켜 실제 타이밍 모사).
    const pushed = await pushToCustomer(
      cid,
      { targetVersion: "1.4.60", assetUrl: "https://x/v1.4.60.exe", assetSha256: "b".repeat(64), assetSize: 34_000_000 },
      {},
      { tenantId: tid, requestedBy: uid },
    );
    expect(pushed).not.toBeNull();
    await testDb()
      .update(pendingUpdates)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(pendingUpdates.id, pushed!.id));

    // 그 뒤 구버전 heartbeat → 자동 롤아웃이 1.4.62 를 추가(target 이 달라 기존핀 미탐지).
    expect(await recordHeartbeat("HB33330003", token, "1.4.54")).toBe(true);

    // 에이전트가 집는 pending = desc(createdAt) 최신 1건. 기대: 운영자 핀 1.4.60. 실제: 1.4.62.
    const served = await getPendingForAgent("HB33330003", token);
    expect(served?.targetVersion).toBe("1.4.60");
  });

  // HBI-7 — os 필드가 무한 text. arch·osBits 는 화이트리스트인데 os 는 trim 만 통과.
  it("HBI-7: os 는 길이 상한/제어문자 정규화가 있어야 저장 남용을 막는다 (arch/osBits 와 비대칭)", async () => {
    const tid = await makeTenant("hbi7");
    await makeCustomer(tid, "남용", "HB77770007");
    const token = await issueToken("HB77770007");
    const huge = "A".repeat(100_000);
    expect(await recordHeartbeat("HB77770007", token, "1.4.54", undefined, "x64", huge, "x64")).toBe(true);
    const r = await readCustomer("HB77770007");
    // 기대: 정당 토큰 1개로 100KB 문자열을 심을 수 없어야(합리적 상한). 실제: 그대로 저장됨.
    expect((r.os ?? "").length).toBeLessThanOrEqual(64);
  });

  // HBI-8 — jti 없는 옛 토큰이 롤링으로 무한 갱신되며 좌석 enforcement 를 영영 우회.
  it("HBI-8: jti-less 토큰은 롤링(재발급)되면 안 된다 — 좀비 로그인 봉인과 배치", async () => {
    const tid = await makeTenant("hbi8");
    const uid = await makeUser(tid, "hbi8@x", "owner");
    // jti 없이 근접만료(11h) 토큰 → needsTokenRefresh 트리거.
    const token = await signCustom(
      { uid, email: "hbi8@x", displayName: "hbi8", role: "owner", tenantId: tid },
      undefined,
      NOW() + 60 * 60 * 11,
    );
    const res = await authHeartbeatPOST(authReq(token));
    expect(res.status).toBe(200);
    const j = await res.json();
    // 기대: jti-less 는 무한연장 금지(재로그인 유도) → token 미탑재. 실제: enforced:false + token 실림.
    expect(j.token).toBeUndefined();
  });

  // HBI-9 — auth heartbeat 버전 정규식이 끝을 앵커하지 않아 접미 오염 문자열을 저장.
  it("HBI-9: 버전은 정확한 semver 프리픽스만 저장돼야 한다 (접미 오염 차단)", async () => {
    const tid = await makeTenant("hbi9");
    const uid = await makeUser(tid, "hbi9@x", "owner");
    const jti = randomUUID();
    // 좌석 확보 + 같은 jti 토큰 → touchHeartbeat 이 users.last_version 을 실제로 씀.
    expect((await claimSeat({ userId: uid, jti, deviceId: "DEV", deviceLabel: null, ip: null })).claimed).toBe(true);
    const { token } = await signApiToken(
      { uid, email: "hbi9@x", displayName: "hbi9", role: "owner", tenantId: tid },
      jti,
    );
    const res = await authHeartbeatPOST(authReq(token, JSON.stringify({ version: "1.2.3'; DROP--" })));
    expect(res.status).toBe(200);
    const [u] = await testDb().select().from(users).where(eq(users.id, uid)).limit(1);
    // 정규식이 끝($)까지 앵커라 접미 오염 버전은 거부된다 → last_version 미갱신(오염값 저장 안 됨).
    expect(u.lastVersion).not.toBe("1.2.3'; DROP--");
    expect(u.lastVersion === null || /^\d+\.\d+\.\d+$/.test(u.lastVersion)).toBe(true);
  });

  // HBI-11 — 정지 tenant 에이전트가 heartbeat 응답으로 원격 cleanup 명령을 계속 수신.
  //   HBI-1 과 같은 게이트 부재의 다른 표면: route 는 tenant 상태와 무관하게 getCleanupRequest 를 실는다.
  it("HBI-11: 정지 tenant 도 원격 cleanup 명령 배달 계속 — 최신 유지·유지보수 정책", async () => {
    const tid = await makeTenant("hbi11", { subscriptionStatus: "suspended" });
    await makeCustomer(tid, "정지원격", "HB11110011");
    const token = await issueToken("HB11110011");
    // 큐된 정리 명령을 모사(데이터 레이어는 tenant 활성 검사를 안 함 — 의도된 동작).
    expect(await requestCleanup("HB11110011", { tenantId: tid })).toBe(true);
    const res = await agentHeartbeatPOST(agentReq({ remoteId: "HB11110011", version: "1.4.60" }, { token }));
    const j = await res.json();
    // 정책(2026-07-21): 정지 tenant 도 원격 유지보수(디스크 정리)는 계속 배달된다.
    expect(typeof j.cleanup).toBe("string");
  });
});
