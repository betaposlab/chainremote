// S1 라운드2 감사 — 서버/네트워크 장애 시나리오. "코드가 아니라 상황에서 출발".
//
// 이 파일은 패널 쪽에서 실행 가능한 조각만 다룬다: "DB 만 죽었을 때 나가는 HTTP 코드가
// 401(클라가 만료로 오판)인지 5xx(클라가 일시오류로 재시도)인지"가 핵심 관심사다.
// hbbs/hbbr/Caddy/네트워크 단절 자체는 이 프로세스에서 재현 불가 — 그건 소스 정독으로
// 판정하고 보고서 S1.md 에 남긴다.
//
// 실 코드(lib/**, app/**)는 절대 수정하지 않는다 — 새 테스트 파일만.
// globalThis.__CR_TEST_DB__ 를 일시적으로 "접근하면 즉시 throw 하는 Proxy"로 바꿔치기해
// "DB 커넥션 거부"를 흉내낸다(pglite 는 인프로세스라 진짜 TCP 장애를 못 만들므로 이 방법이
// 유일한 근사치 — db.select(...) 호출 시점에 realistic 한 pg 드라이버 에러 문구를 던진다).
//
// 계약(2026-08-16): jti 를 박은 토큰은 active_login_sessions 좌석 행이 있어야
// requireApiAuth 의 좌석 대조를 통과한다 — 단, 이 파일의 핵심 케이스는 "DB 가 죽어서
// 좌석 대조 자체에 도달 못 함"을 보는 것이라 일부러 좌석 행을 안 심는다(도달 전에 죽어야 함).

import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { testDb } from "./helpers/db";
import { tenants, users, activeLoginSessions } from "@/lib/schema";
import { signApiToken, jsonError, ApiAuthError } from "@/lib/api-auth";

type Role = "owner" | "admin" | "operator" | "viewer" | "super_admin";

async function makeTenant(slug: string): Promise<string> {
  const [t] = await testDb()
    .insert(tenants)
    .values({ slug, displayName: slug, isActive: true, subscriptionStatus: "active" })
    .returning({ id: tenants.id });
  return t.id;
}

async function makeUser(tenantId: string, email: string, role: Role = "owner"): Promise<string> {
  const [u] = await testDb()
    .insert(users)
    .values({ tenantId, email, passwordHash: "x", displayName: email, role, isActive: true })
    .returning({ id: users.id });
  return u.id;
}

// DB 를 "닿기만 하면 죽는" 상태로 바꾼다. connect ECONNREFUSED 는 실제 pg 드라이버가
// PostgreSQL 프로세스 자체가 죽었을 때 던지는 문구 그대로(테스트 신뢰성을 위해 실제 형식 사용).
function breakDb(message = "connect ECONNREFUSED 127.0.0.1:5432") {
  (globalThis as Record<string, unknown>).__CR_TEST_DB__ = new Proxy(
    {},
    {
      get() {
        throw new Error(message);
      },
    },
  );
}

let savedDb: unknown;
function saveDb() {
  savedDb = (globalThis as Record<string, unknown>).__CR_TEST_DB__;
}
function restoreDb() {
  (globalThis as Record<string, unknown>).__CR_TEST_DB__ = savedDb;
}

afterEach(() => {
  restoreDb();
});

describe("S1-01: DB 만 죽었을 때 HQ heartbeat 라우트가 내는 코드", () => {
  it("requireApiAuth 의 좌석 조회가 DB 에러로 죽으면 401 이 아니라 5xx 로 나가야 한다 " +
    "(HQ 는 401 을 재로그인/만료 신호로 읽는다 — DB 장애를 만료로 오판하면 안 됨)", async () => {
    const tid = await makeTenant("s1-hb-a");
    const uid = await makeUser(tid, "s1-hb-a@x");
    const jti = randomUUID();
    // ★일부러 좌석 행을 안 심는다 — DB 가 죽어 있으면 좌석 조회 자체가 못 끝나야 정상이고,
    //   "좌석이 없어서 401" 과 "DB 가 죽어서 500" 을 섞으면 이 테스트의 판별력이 사라진다.
    const { token } = await signApiToken(
      { uid, email: "s1-hb-a@x", displayName: "u", role: "owner", tenantId: tid },
      jti,
    );

    saveDb();
    breakDb();
    const { POST } = await import("@/app/api/auth/heartbeat/route");
    const req = new Request("http://t/api/auth/heartbeat", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ version: "1.4.131" }),
    });
    const res = await POST(req);
    const text = await res.text();

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);
    // revoked:true 가 실리면 HQ 가 "인계당함"으로 읽어 즉시 강제 로그아웃한다 — DB 장애로
    // 그게 나가면 전 직원이 동시에 튕기는 최악의 오판이 된다.
    expect(text).not.toContain('"revoked":true');
  });
});

describe("S1-02: DB 만 죽었을 때 agent 하트비트 라우트(/api/customers/heartbeat)가 내는 코드", () => {
  it("recordHeartbeat 가 DB 에러로 죽으면 401/403 이 아니라 500 이어야 한다 " +
    "(에이전트는 401/403 만 '토큰 분실'로 보고 재등록 시도를 한다 — DB 장애에 재등록 폭주하면 안 됨)", async () => {
    saveDb();
    breakDb();
    const { POST } = await import("@/app/api/customers/heartbeat/route");
    const req = new Request("http://t/api/customers/heartbeat", {
      method: "POST",
      headers: { "X-ChainRemote-Token": "whatever-token", "content-type": "application/json" },
      body: JSON.stringify({ remoteId: "AB12345678", version: "1.4.131" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("S1-03: jsonError() — DB 커넥션 거부 에러가 문구 그대로 새는지 (isDbError 패턴 밖)", () => {
  // ★2026-08-16 수정됨 — 이 감사가 지적한 구멍을 그날 바로 막았다. 아래는 그 회귀 가드다
  //   (감사 당시엔 "현재 이렇게 샌다"를 실증하는 테스트였다).
  it("연결 계열 에러(ECONNREFUSED 등)도 원문이 바디에 안 실린다", async () => {
    for (const m of [
      "connect ECONNREFUSED 127.0.0.1:5432",
      "connect ETIMEDOUT 10.0.0.5:5432",
      "timeout exceeded when trying to connect",
      "password authentication failed for user \"chainremote\"",
    ]) {
      const res = jsonError(new Error(m));
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("처리 중 오류가 발생했습니다.");
      expect(body.error).not.toContain("5432");
      expect(body.error).not.toContain("chainremote");
    }
  });

  it("대조: 진짜 SQL 구문 에러(Failed query 포함)는 정상적으로 안전 문구로 감춰진다", async () => {
    const dbLikeError = new Error(
      "Failed query: select * from users where id = $1 -- params: [1]",
    );
    const res = jsonError(dbLikeError);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("처리 중 오류가 발생했습니다.");
    expect(body.error).not.toContain("select");
  });

  it("ApiAuthError(revoked) 는 DB 상태와 무관하게 항상 그대로 통과 — 회귀 대조", async () => {
    const res = jsonError(new ApiAuthError(401, "REVOKED", true));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.revoked).toBe(true);
  });
});
