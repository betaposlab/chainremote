// 대리점별 무인접속 에이전트 + HQ 인사말 (마이그 030).
//
// 여기서 정말 지켜야 하는 건 approve-mode 하나다. click 이면 가맹점 사장이 매 세션 직접
// 수락해야 원격이 시작되고, 그게 우리가 파는 제품의 약속이다. 이 값이 실수로 both 로
// 뒤집혀도 화면에 보이는 변화가 없다 — 수락창이 안 뜨는 것을 "빨라졌네" 로 읽는다.
// 그래서 기본값 쪽을 특히 촘촘히 잠근다.
//
// 인사말은 반대로 "안 새는 것" 이 요점이다. HQ 는 빌드가 한 벌이라 남의 대리점 계정에
// 딸려 나가면 그대로 사고다.

import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";

// signApiToken 이 AUTH_SECRET 을 읽으므로 어떤 모듈 import 보다 먼저 세팅.
process.env.AUTH_SECRET ||= "test-secret-unattended-greeting";

import { testDb } from "./helpers/db";
import { tenants, users } from "@/lib/schema";
import { buildAgentCustomTxt } from "@/lib/agent-custom-txt";
import { POST as tokenPOST } from "@/app/api/auth/token/route";

beforeAll(() => {
  process.env.AUTH_SECRET ||= "test-secret-unattended-greeting";
});

const PW = "correct-horse-battery";
const PW_HASH = bcrypt.hashSync(PW, 4);

let ipCounter = 0;
function loginReq(email: string) {
  ipCounter += 1;
  return new Request("http://t/api/auth/token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `10.30.0.${ipCounter}`,
    },
    body: JSON.stringify({
      email,
      password: PW,
      deviceId: `dev-${ipCounter}`,
      deviceLabel: "test-device",
    }),
  });
}

async function makeTenantWithUser(
  slug: string,
  email: string,
  opts: { greeting?: string | null } = {},
): Promise<void> {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug, hqGreeting: opts.greeting ?? null })
    .returning({ id: tenants.id });
  await db.insert(users).values({
    tenantId: t.id,
    email,
    passwordHash: PW_HASH,
    displayName: email,
    role: "owner",
    isActive: true,
  });
}

describe("에이전트 custom.txt — approve-mode 정책", () => {
  it("기본은 click — 가맹점 사장이 매 세션 수락한다", () => {
    const cfg = JSON.parse(buildAgentCustomTxt({ tenantSlug: "s", enrollKey: "k" }));
    expect(cfg["override-settings"]["approve-mode"]).toBe("click");
  });

  it("unattendedAgent 를 명시적으로 false 로 줘도 click", () => {
    const cfg = JSON.parse(
      buildAgentCustomTxt({ tenantSlug: "s", enrollKey: "k", unattendedAgent: false }),
    );
    expect(cfg["override-settings"]["approve-mode"]).toBe("click");
  });

  it("unattendedAgent 를 켠 대리점만 both", () => {
    const cfg = JSON.parse(
      buildAgentCustomTxt({ tenantSlug: "s", enrollKey: "k", unattendedAgent: true }),
    );
    expect(cfg["override-settings"]["approve-mode"]).toBe("both");
  });

  it("approve-mode 는 override-settings 에 있어야 한다 — default 로 내려가면 설치 후 UI 에서 바뀐다", () => {
    const cfg = JSON.parse(buildAgentCustomTxt({ tenantSlug: "s", enrollKey: "k" }));
    expect(cfg["default-settings"]["approve-mode"]).toBeUndefined();
    expect(cfg["override-settings"]).toHaveProperty("approve-mode");
  });

  it("무인접속이든 아니든 tenant-slug·enroll-key 는 항상 실린다", () => {
    // extract-enroll-overlay.ps1 이 이 두 글자가 없으면 오버레이를 통째로 버리고
    // 번들 기본값을 쓴다 → 그 설치본은 아무 대리점에도 소속되지 않는다.
    for (const unattended of [false, true]) {
      const raw = buildAgentCustomTxt({
        tenantSlug: "mansun",
        enrollKey: "deadbeef",
        unattendedAgent: unattended,
      });
      expect(raw).toContain("tenant-slug");
      expect(raw).toContain("enroll-key");
      const cfg = JSON.parse(raw);
      expect(cfg["tenant-slug"]).toBe("mansun");
      expect(cfg["enroll-key"]).toBe("deadbeef");
      expect(cfg["conn-type"]).toBe("incoming");
    }
  });
});

describe("HQ 인사말 — 로그인 응답", () => {
  it("설정한 대리점 계정으로 로그인하면 greeting 이 온다", async () => {
    await makeTenantWithUser("greet-on", "a@greet.test", { greeting: "굿모닝 친구~~" });
    const res = await tokenPOST(loginReq("a@greet.test"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.greeting).toBe("굿모닝 친구~~");
  });

  it("설정 안 한 대리점(대다수)은 아예 안 실린다 — HQ 에서 기능이 없는 것처럼 보인다", async () => {
    await makeTenantWithUser("greet-off", "b@greet.test");
    const res = await tokenPOST(loginReq("b@greet.test"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).not.toHaveProperty("greeting");
  });

  it("남의 대리점 인사말이 딸려 나가지 않는다", async () => {
    await makeTenantWithUser("greet-mine", "c@greet.test", { greeting: "내 것" });
    await makeTenantWithUser("greet-other", "d@greet.test", { greeting: "남의 것" });
    const res = await tokenPOST(loginReq("c@greet.test"));
    const body = await res.json();
    expect(body.user.greeting).toBe("내 것");
    expect(JSON.stringify(body)).not.toContain("남의 것");
  });
});
