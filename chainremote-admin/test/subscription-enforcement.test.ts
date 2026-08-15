// ★ 코워크검토 H1 — 구독/테넌트 정지 enforcement 회귀 테스트.
//
// 질문: subscription_status='suspended' 또는 is_active=false 인 테넌트의 사용자가
// 여전히 로그인/토큰발급이 되는가?
//
// 결론(2026-07-07 소스 실측): 로그인 3경로(NextAuth authorize / POST /api/auth/token /
// POST /api/auth/takeover)와 heartbeat 가 전부 테넌트 상태를 검사한다 → 로그인 시점 차단은
// 견고하다(강하게 검증한다). 단, 이미 발급된 24h 토큰은 requireApiAuth 서명검증만 통과하면
// 되고 리소스 라우트(예: GET /api/customers)는 테넌트 상태를 재검사하지 않는다 → 정지 후에도
// 살아있는 세션은 토큰 만료(최대 24h)나 client-cooperative heartbeat 자진종료 전까지 계속
// 동작한다. 그 잔여 공백을 "현재 동작"으로 문서화(통과)하고, 원하는 하드 서버측 차단을
// it.todo 로 남긴다.
//
// 실 코드(lib/**, app/**)는 절대 수정하지 않는다 — 테스트만.

import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

// signApiToken 이 AUTH_SECRET 을 읽으므로 어떤 모듈 import 보다 먼저 세팅.
process.env.AUTH_SECRET ||= "test-secret-subscription-enforcement";

import { testDb } from "./helpers/db";
import { activeLoginSessions, tenants, users, customers } from "@/lib/schema";
import { isTenantActive } from "@/lib/data/tenants";
import { signApiToken } from "@/lib/api-auth";
import { POST as tokenPOST } from "@/app/api/auth/token/route";
import { POST as takeoverPOST } from "@/app/api/auth/takeover/route";
import { POST as heartbeatPOST } from "@/app/api/auth/heartbeat/route";
import { GET as customersGET } from "@/app/api/customers/route";

beforeAll(() => {
  // 방어적 재확인 (import 순서상 이미 세팅됨).
  process.env.AUTH_SECRET ||= "test-secret-subscription-enforcement";
});

const PW = "correct-horse-battery";
const PW_HASH = bcrypt.hashSync(PW, 4); // 라운드 낮춰 테스트 속도.

interface TenantOpts {
  isActive?: boolean;
  subscriptionStatus?: "active" | "suspended" | "cancelled";
}

async function makeTenant(slug: string, opts: TenantOpts = {}): Promise<string> {
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

async function makeUser(
  tenantId: string,
  email: string,
  role: "owner" | "admin" | "operator" | "viewer" | "super_admin" = "owner",
): Promise<string> {
  const db = testDb();
  const [u] = await db
    .insert(users)
    .values({
      tenantId,
      email,
      passwordHash: PW_HASH,
      displayName: email,
      role,
      isActive: true,
    })
    .returning({ id: users.id });
  return u.id;
}

// 로그인/takeover 라우트는 email 6/min·IP 15/min rate-limit 을 in-memory 로 공유한다.
// 테스트 간섭을 피하려 매 호출 고유 email + 고유 X-Forwarded-For 를 쓴다.
let ipCounter = 0;
function loginReq(url: string, email: string, password: string, deviceId = "dev-1") {
  ipCounter += 1;
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.0.0.${ipCounter}`,
    },
    body: JSON.stringify({ email, password, deviceId, deviceLabel: "test-device" }),
  });
}

describe("H1 구독/테넌트 정지 enforcement", () => {
  // ── 데이터 레이어 프리미티브: isTenantActive ──────────────────────────
  describe("isTenantActive() — 정지 판별 프리미티브 (heartbeat 가 이걸 씀)", () => {
    it("활성 테넌트(is_active=true, status=active) → true", async () => {
      const tid = await makeTenant("active-co");
      expect(await isTenantActive(tid)).toBe(true);
    });

    it("subscription_status='suspended' → false", async () => {
      const tid = await makeTenant("suspended-co", { subscriptionStatus: "suspended" });
      expect(await isTenantActive(tid)).toBe(false);
    });

    it("subscription_status='cancelled' → false", async () => {
      const tid = await makeTenant("cancelled-co", { subscriptionStatus: "cancelled" });
      expect(await isTenantActive(tid)).toBe(false);
    });

    it("is_active=false (구독 status 는 active 여도) → false", async () => {
      const tid = await makeTenant("deactivated-co", { isActive: false });
      expect(await isTenantActive(tid)).toBe(false);
    });

    it("존재하지 않는 tenantId → false (미존재도 차단)", async () => {
      expect(await isTenantActive("00000000-0000-0000-0000-000000000000")).toBe(false);
    });
  });

  // ── POST /api/auth/token — 데스크톱 앱 로그인 토큰 발급 ────────────────
  describe("POST /api/auth/token — 정지 테넌트 로그인 차단", () => {
    const URL = "http://t/api/auth/token";

    it("활성 테넌트 + 올바른 비번 → 200 + 토큰 발급", async () => {
      const tid = await makeTenant("tok-active");
      await makeUser(tid, "tok-active@x");
      const res = await tokenPOST(loginReq(URL, "tok-active@x", PW));
      expect(res.status).toBe(200);
      const j = await res.json();
      expect(typeof j.token).toBe("string");
      expect(j.user.email).toBe("tok-active@x");
    });

    it("★ suspended 테넌트 사용자는 올바른 비번이어도 403 (H1 차단 확인)", async () => {
      const tid = await makeTenant("tok-suspended", { subscriptionStatus: "suspended" });
      await makeUser(tid, "tok-suspended@x");
      const res = await tokenPOST(loginReq(URL, "tok-suspended@x", PW));
      expect(res.status).toBe(403);
      const j = await res.json();
      expect(j.token).toBeUndefined();
      expect(j.error).toContain("정지");
    });

    it("cancelled 테넌트 사용자 → 403", async () => {
      const tid = await makeTenant("tok-cancelled", { subscriptionStatus: "cancelled" });
      await makeUser(tid, "tok-cancelled@x");
      const res = await tokenPOST(loginReq(URL, "tok-cancelled@x", PW));
      expect(res.status).toBe(403);
      expect((await res.json()).token).toBeUndefined();
    });

    it("is_active=false 테넌트 사용자 → 403", async () => {
      const tid = await makeTenant("tok-inactive", { isActive: false });
      await makeUser(tid, "tok-inactive@x");
      const res = await tokenPOST(loginReq(URL, "tok-inactive@x", PW));
      expect(res.status).toBe(403);
      expect((await res.json()).token).toBeUndefined();
    });

    it("super_admin 은 정지 테넌트여도 예외적으로 로그인 허용 (자기잠금 방지 — 의도된 동작)", async () => {
      // 문서화: super_admin(Chang 본사 tenant)은 구독 대상이 아니라 정지돼도 통과한다.
      // betaposlab 자기 tenant 라 악용 표면이 아님. 잔여 위험은 vulnerabilities 에 low 로 기록.
      const tid = await makeTenant("tok-super", { subscriptionStatus: "suspended" });
      await makeUser(tid, "tok-super@x", "super_admin");
      const res = await tokenPOST(loginReq(URL, "tok-super@x", PW));
      expect(res.status).toBe(200);
      expect((await res.json()).token).toBeDefined();
    });

    it("정지든 활성이든 비번 틀리면 401 (자격 우선 검사)", async () => {
      const tid = await makeTenant("tok-badpw", { subscriptionStatus: "suspended" });
      await makeUser(tid, "tok-badpw@x");
      const res = await tokenPOST(loginReq(URL, "tok-badpw@x", "WRONG"));
      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/auth/takeover — "강제 종료하고 사용" 경로도 동일 차단 ─────
  describe("POST /api/auth/takeover — 정지 테넌트 차단", () => {
    const URL = "http://t/api/auth/takeover";

    it("suspended 테넌트 사용자 takeover → 403 (좌석 탈취 경로도 막힘)", async () => {
      const tid = await makeTenant("tko-suspended", { subscriptionStatus: "suspended" });
      await makeUser(tid, "tko-suspended@x");
      const res = await takeoverPOST(loginReq(URL, "tko-suspended@x", PW));
      expect(res.status).toBe(403);
      expect((await res.json()).token).toBeUndefined();
    });

    it("활성 테넌트 takeover → 200 + 토큰", async () => {
      const tid = await makeTenant("tko-active");
      await makeUser(tid, "tko-active@x");
      const res = await takeoverPOST(loginReq(URL, "tko-active@x", PW));
      expect(res.status).toBe(200);
      expect((await res.json()).token).toBeDefined();
    });
  });

  // ── POST /api/auth/heartbeat — 24h 토큰이 정지 후에도 살아있는 공백 메움 ─
  describe("POST /api/auth/heartbeat — 정지 후 heartbeat 401", () => {
    async function bearer(uid: string, tenantId: string, role: ApiRole) {
      const jti = "11111111-1111-1111-1111-111111111111";
      const { token } = await signApiToken(
        { uid, email: `${uid}@x`, displayName: uid, role, tenantId },
        jti,
      );
      // 좌석 행 필요(A2-03 수정 이후) — 실 발급 경로도 좌석을 먼저 잡는다.
      await testDb()
        .insert(activeLoginSessions)
        .values({ userId: uid, jti, deviceId: "test-dev", deviceLabel: "test" })
        .onConflictDoNothing();
      return token;
    }

    it("정지 테넌트 토큰의 heartbeat → 401 (앱이 세션 끊도록 유도)", async () => {
      const tid = await makeTenant("hb-suspended", { subscriptionStatus: "suspended" });
      const uid = await makeUser(tid, "hb-suspended@x");
      const token = await bearer(uid, tid, "owner");
      const req = new Request("http://t/api/auth/heartbeat", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      });
      const res = await heartbeatPOST(req);
      expect(res.status).toBe(401);
      expect((await res.json()).error).toContain("정지");
    });
  });

  // ── H1 잔여공백 봉인(2026-07-07): 리소스 라우트도 requireApiAuth 에서 테넌트 상태 재검사 ─
  describe("[수정됨] 정지 후 기존 토큰은 리소스 라우트에서도 즉시 차단된다", () => {
    it("활성 중 발급된 토큰이라도 정지되면 GET /api/customers 가 401 로 거부된다", async () => {
      const db = testDb();
      // 활성 상태에서 로그인해 토큰을 얻는다.
      const tid = await makeTenant("gap-co");
      const uid = await makeUser(tid, "gap-co@x");
      await db.insert(customers).values({ tenantId: tid, name: "정지전거래처", remoteId: "GAP001" });
      const { token } = await signApiToken(
        { uid, email: "gap-co@x", displayName: "gap", role: "owner", tenantId: tid },
        "22222222-2222-2222-2222-222222222222",
      );
      // 좌석 행 필요(A2-03 수정 이후) — 실 발급 경로도 좌석을 먼저 잡는다.
      await db
        .insert(activeLoginSessions)
        .values({ userId: uid, jti: "22222222-2222-2222-2222-222222222222", deviceId: "test-dev", deviceLabel: "test" })
        .onConflictDoNothing();

      // 이제 테넌트를 정지시킨다.
      await db
        .update(tenants)
        .set({ subscriptionStatus: "suspended" })
        .where(eq(tenants.id, tid));
      expect(await isTenantActive(tid)).toBe(false); // 정지 확정.

      // ★ 이제 리소스 라우트도 서버측에서 401 로 거부(requireApiAuth 가 테넌트 상태 재검사).
      //    heartbeat 와 동일한 401(재로그인 유도, token 라우트가 403 으로 최종 차단)로 일관.
      const req = new Request("http://t/api/customers", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });
      const res = await customersGET(req);
      expect(res.status).toBe(401);
    });

    it("super_admin(본사)은 자기잠금 방지로 정지 상태에서도 리소스 접근 유지", async () => {
      const db = testDb();
      const tid = await makeTenant("hq-co", { subscriptionStatus: "suspended" });
      // ★DB 계정도 super_admin 이어야 한다(2026-08-16, A2-05) — requireApiAuth 가 토큰의
      //   role 이 아니라 DB 현재값을 믿는다. 종전엔 토큰만 super_admin 이면 통과했다.
      const uid = await makeUser(tid, "hq@x", "super_admin");
      const { token } = await signApiToken(
        { uid, email: "hq@x", displayName: "hq", role: "super_admin", tenantId: tid },
        "33333333-3333-3333-3333-333333333333",
      );
      // 좌석 행 필요(A2-03 수정 이후) — 실 발급 경로도 좌석을 먼저 잡는다.
      await db
        .insert(activeLoginSessions)
        .values({ userId: uid, jti: "33333333-3333-3333-3333-333333333333", deviceId: "test-dev", deviceLabel: "test" })
        .onConflictDoNothing();
      const req = new Request("http://t/api/customers", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });
      const res = await customersGET(req);
      expect(res.status).toBe(200); // super_admin 예외 — 봉인돼도 본사는 관리 가능
    });
  });
});

type ApiRole = "owner" | "admin" | "operator" | "viewer" | "super_admin";
