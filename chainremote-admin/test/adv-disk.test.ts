// 적대적 테스트 — disk 영역: heartbeat 디스크 telemetry + 정리 요청/결과 큐 왕복.
//
// 노리는 표면(마이그 024):
//   - recordHeartbeat 의 diskSet/cleanupSet 이상값·경합·중복 처리(lib/data/customers.ts)
//   - POST /api/customers/cleanup 권한/격리/입력 계약(app/api/customers/cleanup/route.ts)
//   - POST /api/customers/heartbeat 이상값 방어(app/api/customers/heartbeat/route.ts)
//   - DiskChip 5GB/8GB 임계값 색상판정(app/customers/_disk-chip.tsx) — 실제 렌더
//
// 규칙: 소스는 절대 수정하지 않는다. "의도 vs 실제" 가 어긋나는 케이스는 억지 통과시키지 않고
// 실패 상태로 남겨 버그 후보로 드러낸다(별도 describe 로 분리 — 나머지 통과 케이스는 수집됨).
//
// DiskChip 은 client component 라 @/lib/actions/customers(서버액션, next-auth 체인) 를 import 한다.
// 그 체인이 이 포크에서 vitest 로드에 실패하므로(next/server 해석), 순수 렌더에 안 쓰이는
// 서버액션만 vi.mock 으로 스텁한다 — DiskChip 의 색상/레벨 로직 자체는 원본 그대로 실행된다.

import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// signApiToken 이 AUTH_SECRET 을 읽는다(setup.ts 가 이미 세팅하지만 방어적 재확인).
process.env.AUTH_SECRET ||= "test-secret-chainremote-suite";

vi.mock("@/lib/actions/customers", () => ({
  requestCleanupAction: async () => true,
}));

import { testDb } from "./helpers/db";
import {
  registerHeartbeatToken,
  recordHeartbeat,
  requestCleanup,
  getCleanupRequest,
} from "@/lib/data/customers";
import { tenants, customers, users } from "@/lib/schema";
import { signApiToken } from "@/lib/api-auth";
import { POST as cleanupPOST } from "@/app/api/customers/cleanup/route";
import { POST as heartbeatPOST } from "@/app/api/customers/heartbeat/route";
import { DiskChip } from "@/app/customers/_disk-chip";

const GB = 1024 ** 3;

type SubStatus = "active" | "suspended" | "cancelled";

async function makeTenant(
  slug: string,
  opts: { isActive?: boolean; subscriptionStatus?: SubStatus } = {},
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

async function makeCustomer(tenantId: string, name: string, remoteId: string) {
  const db = testDb();
  const [c] = await db
    .insert(customers)
    .values({ tenantId, name, remoteId })
    .returning({ id: customers.id });
  return c.id;
}

// 거래처 + heartbeat 토큰까지 한 번에.
async function seed(
  slug: string,
  remoteId: string,
  opts: { isActive?: boolean; subscriptionStatus?: SubStatus } = {},
) {
  const tenantId = await makeTenant(slug, opts);
  const customerId = await makeCustomer(tenantId, slug, remoteId);
  const token = await registerHeartbeatToken(remoteId);
  return { tenantId, customerId, token: token! };
}

async function row(remoteId: string) {
  const db = testDb();
  const [r] = await db
    .select()
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return r;
}

// Bearer 토큰 발급 — ★실제 user 행을 만들어 그 id 로 서명한다.
//   requireApiAuth 가 "이 계정이 지금도 살아 있나"를 조회하기 때문이다(퇴사자 즉시 차단,
//   2026-08-15). 종전엔 uid 를 "u-owner" 같은 가짜로 넣어도 통과했는데, 그건 삭제된 계정의
//   토큰이 24h 동안 살아 있던 시절의 계약이다.
async function bearer(
  tenantId: string,
  role: "owner" | "admin" | "operator" | "viewer" | "super_admin",
): Promise<string> {
  const db = testDb();
  const [u] = await db
    .insert(users)
    .values({
      tenantId,
      email: `${role}-${tenantId.slice(0, 8)}@x`,
      displayName: role,
      passwordHash: "x",
      role,
    })
    .returning({ id: users.id });
  const { token } = await signApiToken({
    uid: u.id,
    email: role + "@x",
    displayName: role,
    role,
    tenantId,
  });
  return token;
}

let ipc = 0;
function hbReq(bodyObjOrRaw: unknown, token?: string) {
  ipc += 1;
  const body =
    typeof bodyObjOrRaw === "string" ? bodyObjOrRaw : JSON.stringify(bodyObjOrRaw);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.9.0.${ipc}`,
  };
  if (token) headers["X-ChainRemote-Token"] = token;
  return new Request("http://t/api/customers/heartbeat", {
    method: "POST",
    headers,
    body,
  });
}

function cleanupReq(bodyObjOrRaw: unknown, token?: string) {
  const body =
    typeof bodyObjOrRaw === "string" ? bodyObjOrRaw : JSON.stringify(bodyObjOrRaw);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://t/api/customers/cleanup", {
    method: "POST",
    headers,
    body,
  });
}

function renderChip(props: {
  totalBytes: number | null;
  freeBytes: number | null;
  tempBytes?: number | null;
  cleanupRequestedAt?: string | null;
  cleanupResult?: string | null;
}): string {
  return renderToStaticMarkup(
    createElement(DiskChip, {
      remoteId: "RID",
      tempBytes: null,
      cleanupRequestedAt: null,
      cleanupResult: null,
      ...props,
    }),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════════════════════
// 통과군 — 의도된 동작 / 방어 회귀가드 / 격리·권한·입력 계약이 지켜지는지
// ════════════════════════════════════════════════════════════════════════════
describe("disk — 통과(의도된 동작·방어 회귀가드)", () => {
  // ── disk-04: 5GB/8GB 임계값 정확 경계 색상판정(strict <) — 실제 DiskChip 렌더 ──
  describe("disk-04 임계값 경계 색상판정", () => {
    it("정확히 5GB → amber(🟡), red 아님 (free<5GB 는 false)", () => {
      const h = renderChip({ totalBytes: 120 * GB, freeBytes: 5 * GB });
      expect(h).toContain("🟡");
      expect(h).not.toContain("🔴");
      expect(h).toContain("bg-amber-500/12");
      expect(h).toContain(">정리<"); // level!==ok → 정리 버튼
    });

    it("5GB - 1byte → red(🔴)", () => {
      const h = renderChip({ totalBytes: 120 * GB, freeBytes: 5 * GB - 1 });
      expect(h).toContain("🔴");
      expect(h).not.toContain("🟡");
      expect(h).toContain("bg-[#ff5a5f]/12");
      expect(h).toContain(">정리<");
    });

    it("정확히 8GB → ok (이모지·정리버튼 없음, free<8GB 는 false)", () => {
      const h = renderChip({ totalBytes: 120 * GB, freeBytes: 8 * GB });
      expect(h).not.toContain("🔴");
      expect(h).not.toContain("🟡");
      expect(h).toContain("bg-white/[0.06]"); // 중립(ok) 칩 다크톤 — 2026-08-05 패널 리디자인
      expect(h).not.toContain(">정리<");
      expect(h).not.toContain("정리 중");
    });

    it("8GB - 1byte → amber(🟡)", () => {
      const h = renderChip({ totalBytes: 120 * GB, freeBytes: 8 * GB - 1 });
      expect(h).toContain("🟡");
      expect(h).not.toContain("🔴");
      expect(h).toContain("bg-amber-500/12");
    });

    it("totalBytes=0 → 아무것도 렌더 안 함(null)", () => {
      expect(renderChip({ totalBytes: 0, freeBytes: 1 * GB })).toBe("");
    });

    it("totalBytes=null / freeBytes=null → 렌더 안 함(null)", () => {
      expect(renderChip({ totalBytes: null, freeBytes: 1 * GB })).toBe("");
      expect(renderChip({ totalBytes: 120 * GB, freeBytes: null })).toBe("");
    });

    it("정리 요청 대기 중이면 [정리] 대신 '정리 중…' 표시(red 인데 버튼 대신 대기)", () => {
      const h = renderChip({
        totalBytes: 120 * GB,
        freeBytes: 2 * GB,
        cleanupRequestedAt: new Date().toISOString(),
      });
      expect(h).toContain("🔴");
      expect(h).toContain("정리 중");
      expect(h).not.toContain(">정리<");
    });
  });

  // ── disk-06: Infinity 디스크값은 방어 로직이 걸러 heartbeat 를 안 깬다 ──
  it("disk-06 Infinity(1e999) 디스크값은 무시되고 기존값 보존 + 200", async () => {
    const s = await seed("disk-adv-06", "DKADV0006");
    await recordHeartbeat(
      "DKADV0006", s.token, "1.4.59", undefined, undefined, undefined, undefined,
      { diskTotal: 120 * GB, diskFree: 40 * GB },
    );
    // JSON.parse('1e999') === Infinity — raw body 로 보내야 한다(JSON.stringify(Infinity)='null').
    const res = await heartbeatPOST(
      hbReq(
        `{"remoteId":"DKADV0006","version":"1.4.59","diskTotal":1e999,"diskFree":1e999}`,
        s.token,
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const r = await row("DKADV0006");
    expect(r.diskTotalBytes).toBe(120 * GB); // 보존
    expect(r.diskFreeBytes).toBe(40 * GB);
  });

  // ── disk-03(정상측): diskFree=0 + diskTotal>0(진짜 꽉 참)은 정상값으로 받아 red ──
  it("disk-03b diskFree=0 + diskTotal=120GB(꽉 참)은 정상 저장 → red 판정", async () => {
    const s = await seed("disk-adv-03b", "DKADV003B");
    const ok = await recordHeartbeat(
      "DKADV003B", s.token, "1.4.59", undefined, undefined, undefined, undefined,
      { diskTotal: 120 * GB, diskFree: 0 },
    );
    expect(ok).toBe(true);
    const r = await row("DKADV003B");
    expect(r.diskTotalBytes).toBe(120 * GB);
    expect(r.diskFreeBytes).toBe(0);
    // UI: free 0 < 5GB → red
    const h = renderChip({ totalBytes: 120 * GB, freeBytes: 0 });
    expect(h).toContain("🔴");
  });

  // ── disk-07: 정지/해지/비활성 테넌트 Bearer 로는 cleanup 라우트 차단(401) ──
  describe("disk-07 정지 테넌트의 cleanup 라우트 차단", () => {
    it("suspended 테넌트 owner 토큰 → 401, requestCleanup 미실행", async () => {
      const s = await seed("disk-adv-07s", "DKADV007S", {
        subscriptionStatus: "suspended",
      });
      const tok = await bearer(s.tenantId, "owner");
      const res = await cleanupPOST(cleanupReq({ remoteId: "DKADV007S" }, tok));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toContain("정지");
      const r = await row("DKADV007S");
      expect(r.cleanupRequestedAt).toBeNull(); // 큐잉 안 됨
    });

    it("cancelled 테넌트 owner 토큰 → 401", async () => {
      const s = await seed("disk-adv-07c", "DKADV007C", {
        subscriptionStatus: "cancelled",
      });
      const tok = await bearer(s.tenantId, "owner");
      const res = await cleanupPOST(cleanupReq({ remoteId: "DKADV007C" }, tok));
      expect(res.status).toBe(401);
      expect((await row("DKADV007C")).cleanupRequestedAt).toBeNull();
    });

    it("is_active=false 테넌트 owner 토큰 → 401", async () => {
      const s = await seed("disk-adv-07i", "DKADV007I", { isActive: false });
      const tok = await bearer(s.tenantId, "owner");
      const res = await cleanupPOST(cleanupReq({ remoteId: "DKADV007I" }, tok));
      expect(res.status).toBe(401);
      expect((await row("DKADV007I")).cleanupRequestedAt).toBeNull();
    });

    it("super_admin 은 정지 테넌트여도 예외 통과 → 200 (자기잠금 방지, 의도)", async () => {
      const s = await seed("disk-adv-07sa", "DKADV07SA", {
        subscriptionStatus: "suspended",
      });
      const tok = await bearer(s.tenantId, "super_admin");
      const res = await cleanupPOST(cleanupReq({ remoteId: "DKADV07SA" }, tok));
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
      expect((await row("DKADV07SA")).cleanupRequestedAt).not.toBeNull();
    });
  });

  // ── disk-08: 타 tenant 거래처에 cleanup 요청 시 404(라우트 레벨 격리) ──
  it("disk-08 타 tenant 토큰으로 남의 거래처 cleanup → 404, 원본 큐 무변경", async () => {
    const a = await seed("disk-adv-08a", "DKADV008A");
    const bTenant = await makeTenant("disk-adv-08b");
    const bTok = await bearer(bTenant, "owner");
    const res = await cleanupPOST(cleanupReq({ remoteId: "DKADV008A" }, bTok));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("거래처");
    expect((await row("DKADV008A")).cleanupRequestedAt).toBeNull();
    void a;
  });

  // ── disk-09: 요청 없는 unsolicited cleanupResult 의 현재 동작 문서화 ──
  // 계약상 강한 "거부" 불변식이 없다(토큰 인증된 에이전트가 자기 레코드에 자기 telemetry 보고).
  // 큐가 이미 null 이라 null 재설정은 무해. 현재 동작(저장됨)을 사실대로 고정한다.
  it("disk-09 요청 없이 온 cleanupResult 는 저장되고 큐는 null 유지(현 동작 문서화)", async () => {
    const s = await seed("disk-adv-09", "DKADV0009");
    expect(await getCleanupRequest("DKADV0009")).toBeNull(); // 대기 요청 없음
    const result = JSON.stringify({ freedBytes: 3 * GB, deleted: 10, at: "2026-07-20T00:00:00Z" });
    const ok = await recordHeartbeat(
      "DKADV0009", s.token, "1.4.59", undefined, undefined, undefined, undefined,
      { cleanupResult: result },
    );
    expect(ok).toBe(true);
    const r = await row("DKADV0009");
    expect(r.cleanupResult).toBe(result); // 현재는 그대로 저장(자가보고 telemetry 허용)
    expect(r.cleanupRequestedAt).toBeNull(); // 원래 null → 여전히 null(무해)
  });

  // ── disk-10: 공백만 있는 cleanupResult 는 '보고 없음'과 동일 취급(큐 안 비움) ──
  // 이 .trim() 가드는 결과 없는 일반 heartbeat 가 큐를 조기 클리어하지 못하게 막는 load-bearing
  // 로직과 동일하다. 실제 에이전트는 JSON.stringify 결과(비공백)만 보내므로 공백-only 는 기형
  // 입력이고 '보고 없음'으로 보는 것이 방어적으로 타당 → 현재 동작을 사실대로 고정(버그 아님).
  it("disk-10 공백-only cleanupResult 는 결과 미저장 + 큐 유지(현 동작 문서화)", async () => {
    const s = await seed("disk-adv-10", "DKADV0010");
    expect(await requestCleanup("DKADV0010", { tenantId: s.tenantId })).toBe(true);
    await recordHeartbeat(
      "DKADV0010", s.token, "1.4.59", undefined, undefined, undefined, undefined,
      { cleanupResult: "   \n\t " },
    );
    const r = await row("DKADV0010");
    expect(r.cleanupResult).toBeNull(); // 공백 결과는 저장 안 됨
    expect(r.cleanupRequestedAt).not.toBeNull(); // 큐 유지 — 일반 heartbeat 오클리어 방지와 동일 가드
  });

  // ── disk-11: cleanup 라우트 입력 계약(401/400/400/404/400), 500 안 샘 ──
  describe("disk-11 cleanup 라우트 입력 계약", () => {
    it("(a) Authorization 없음 → 401", async () => {
      const res = await cleanupPOST(cleanupReq({ remoteId: "X" }));
      expect(res.status).toBe(401);
    });

    it("(b) 공백 remoteId → 400", async () => {
      const t = await makeTenant("disk-adv-11b");
      const tok = await bearer(t, "owner");
      const res = await cleanupPOST(cleanupReq({ remoteId: "   " }, tok));
      expect(res.status).toBe(400);
    });

    it("(c) remoteId 누락 → 400", async () => {
      const t = await makeTenant("disk-adv-11c");
      const tok = await bearer(t, "owner");
      const res = await cleanupPOST(cleanupReq({}, tok));
      expect(res.status).toBe(400);
    });

    it("(d) 존재하지 않는 remoteId → 404", async () => {
      const t = await makeTenant("disk-adv-11d");
      const tok = await bearer(t, "owner");
      const res = await cleanupPOST(cleanupReq({ remoteId: "NOPE99999" }, tok));
      expect(res.status).toBe(404);
    });

    it("(e) 비 JSON body → 400 (catch(()=>({})) 경로)", async () => {
      const t = await makeTenant("disk-adv-11e");
      const tok = await bearer(t, "owner");
      const res = await cleanupPOST(cleanupReq("not json at all", tok));
      expect(res.status).toBe(400);
    });
  });

  // ── disk-12: 위조/불일치 heartbeat 토큰으로 남의 telemetry 오염 불가(403) ──
  describe("disk-12 토큰 검증 우회로 디스크·정리결과 오염 불가", () => {
    it("다른 거래처 토큰으로 X 의 heartbeat → 403, X telemetry 무변경", async () => {
      const x = await seed("disk-adv-12x", "DKADV012X");
      await recordHeartbeat(
        "DKADV012X", x.token, "1.4.59", undefined, undefined, undefined, undefined,
        { diskTotal: 200 * GB, diskFree: 50 * GB },
      );
      const y = await seed("disk-adv-12y", "DKADV012Y");
      const res = await heartbeatPOST(
        hbReq(
          { remoteId: "DKADV012X", version: "9.9.9", diskTotal: 1 * GB, diskFree: 1 * GB, cleanupResult: '{"freedBytes":1}' },
          y.token, // 남의 토큰
        ),
      );
      expect(res.status).toBe(403);
      const r = await row("DKADV012X");
      expect(r.diskFreeBytes).toBe(50 * GB); // 안 바뀜
      expect(r.cleanupResult).toBeNull();
      expect(r.lastVersion).not.toBe("9.9.9");
    });

    it("임의 문자열 토큰으로 X 의 heartbeat → 403", async () => {
      const x = await seed("disk-adv-12z", "DKADV012Z");
      await recordHeartbeat(
        "DKADV012Z", x.token, "1.4.59", undefined, undefined, undefined, undefined,
        { diskTotal: 200 * GB, diskFree: 50 * GB },
      );
      const res = await heartbeatPOST(
        hbReq({ remoteId: "DKADV012Z", version: "9.9.9", diskFree: 1 * GB, diskTotal: 1 * GB }, "garbage-token"),
      );
      expect(res.status).toBe(403);
      expect((await row("DKADV012Z")).diskFreeBytes).toBe(50 * GB);
    });
  });

  // ── disk-13: diskFree > diskTotal(논리적 불일치)의 현재 동작 문서화(저위험) ──
  it("disk-13 diskFree>diskTotal 은 무검증 저장(telemetry) — 현 동작 문서화", async () => {
    const s = await seed("disk-adv-13", "DKADV0013");
    const ok = await recordHeartbeat(
      "DKADV0013", s.token, "1.4.59", undefined, undefined, undefined, undefined,
      { diskTotal: 100 * GB, diskFree: 500 * GB },
    );
    expect(ok).toBe(true);
    const r = await row("DKADV0013");
    expect(r.diskFreeBytes).toBe(500 * GB); // 클램프/거부 없이 그대로
    // UI: free 500GB → level ok (색상판정 왜곡되나 저위험 — 문서화)
    const h = renderChip({ totalBytes: 100 * GB, freeBytes: 500 * GB });
    expect(h).toContain("bg-white/[0.06]"); // 중립(ok) 칩 다크톤 — 2026-08-05 패널 리디자인
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 버그 후보군 — 의도된 동작과 실제 동작이 어긋남. 억지 통과 금지, 실패로 남겨 드러낸다.
// (별도 describe 라 위 통과군 수집엔 영향 없음.)
// ════════════════════════════════════════════════════════════════════════════
describe("disk — 버그 후보(의도 vs 실제 divergence)", () => {
  // ── disk-01: stale 결과 보고가 더 새로운 정리 요청을 삭제(명령 유실) ──
  it("disk-01 T1 결과 보고가 이후 큐된 T2 요청을 취소하면 안 된다", async () => {
    const s = await seed("disk-adv-01", "DKADV0001");

    // 운영자 [정리] → T1 큐잉, 에이전트가 T1 을 읽어감
    expect(await requestCleanup("DKADV0001", { tenantId: s.tenantId })).toBe(true);
    const t1 = await getCleanupRequest("DKADV0001");
    expect(t1).not.toBeNull();

    // 에이전트가 T1 실행하는 사이 운영자가 재클릭 → T2(>T1) 큐잉
    await sleep(8);
    expect(await requestCleanup("DKADV0001", { tenantId: s.tenantId })).toBe(true);
    const t2 = await getCleanupRequest("DKADV0001");
    expect(t2).not.toBe(t1); // T2 는 T1 보다 나중(다른 타임스탬프)

    // 이제 에이전트가 (아까 읽은) T1 실행 결과를 보고 — result.at 은 T1 시점(<T2)
    const result = JSON.stringify({ freedBytes: 6 * GB, deleted: 200, skipped: 0, at: t1 });
    await recordHeartbeat(
      "DKADV0001", s.token, "1.4.59", undefined, undefined, undefined, undefined,
      { cleanupResult: result },
    );

    // 기대: T2 요청은 아직 살아있어야 한다(에이전트가 T2 를 실행해야 함).
    // 실제: cleanupSet 이 대조 없이 무조건 cleanupRequestedAt=null → T2 유실.
    expect(await getCleanupRequest("DKADV0001")).not.toBeNull();
  });

  // ── disk-02: viewer Bearer 토큰이 라우트로 파괴적 정리 명령 큐잉(권한 divergence) ──
  it("disk-02 viewer 롤 Bearer 는 cleanup 라우트에서도 403 이어야 한다", async () => {
    const s = await seed("disk-adv-02", "DKADV0002");
    const tok = await bearer(s.tenantId, "viewer");
    const res = await cleanupPOST(cleanupReq({ remoteId: "DKADV0002" }, tok));
    // 기대: 세션 액션(requestCleanupAction)이 viewer 를 막듯 라우트도 403.
    // 실제: 라우트에 롤 게이트 부재 → 200 ok:true 로 파괴적 정리 큐잉됨.
    expect(res.status).toBe(403);
  });

  // ── disk-03: diskTotal=0 이상값이 정상 telemetry 를 0/0 으로 덮어써 칩을 숨김 ──
  it("disk-03 diskTotal=0 이상값은 무시하고 기존 120/40GB 를 보존해야 한다", async () => {
    const s = await seed("disk-adv-03", "DKADV0003");
    await recordHeartbeat(
      "DKADV0003", s.token, "1.4.59", undefined, undefined, undefined, undefined,
      { diskTotal: 120 * GB, diskFree: 40 * GB },
    );
    // 드라이브 미준비/WMI 히컵 흉내 — total=0 은 물리적으로 불가능한 이상값.
    await recordHeartbeat(
      "DKADV0003", s.token, "1.4.59", undefined, undefined, undefined, undefined,
      { diskTotal: 0, diskFree: 0 },
    );
    const r = await row("DKADV0003");
    // 기대: 총량 0 은 이상값 → 무시(계약: 유효 양수일 때만 반영). 실제: num 이 0 통과 → 0/0 저장.
    expect(r.diskTotalBytes).toBe(120 * GB);
    expect(r.diskFreeBytes).toBe(40 * GB);
  });

  // ── disk-05: 상한 없는 거대 finite diskFree(1e19) → bigint 범위 초과 → 500 ──
  it("disk-05 거대값(1e19)이 heartbeat 파이프라인을 500 으로 깨면 안 된다", async () => {
    const s = await seed("disk-adv-05", "DKADV0005");
    await recordHeartbeat(
      "DKADV0005", s.token, "1.4.59", undefined, undefined, undefined, undefined,
      { diskTotal: 120 * GB, diskFree: 40 * GB },
    );
    const res = await heartbeatPOST(
      hbReq(
        `{"remoteId":"DKADV0005","version":"1.4.59","diskTotal":1e19,"diskFree":1e19}`,
        s.token,
      ),
    );
    // 기대: 비정상 거대값은 이상값으로 무시하고 200(ok). 실제: 상한 검사 부재 → bigint out of range → 500.
    expect(res.status).toBe(200);
  });

  // ── disk-06: 용량 상위 폴더 실측(044) 왕복 ──
  //   에이전트는 여유 부족일 때 6시간에 한 번만 보낸다. 그래서 "안 보낸 heartbeat 가
  //   먼저 잰 값을 지우지 않는가"가 이 기능의 급소다 — 지워지면 데이터가 영영 안 쌓인다.
  it("disk-06 topDirs 는 저장되고, 안 보낸 heartbeat 가 그걸 지우지 않는다", async () => {
    const s = await seed("disk-adv-06b", "DKADV006B");
    await recordHeartbeat(
      "DKADV006B", s.token, "1.4.116", undefined, undefined, undefined, undefined,
      {
        diskTotal: 120 * GB,
        diskFree: 4 * GB,
        topDirs: [
          { name: "Local\\배달앱A", bytes: 3 * GB },
          { name: "Local\\배달대행B", bytes: 1 * GB },
        ],
      },
    );
    let r = await row("DKADV006B");
    expect(r.topDirs).toHaveLength(2);
    expect(r.topDirs?.[0].name).toBe("Local\\배달앱A");
    expect(r.topDirs?.[0].bytes).toBe(3 * GB);

    // 다음 heartbeat 는 실측을 안 실었다(6시간 캐시). 앞서 잰 값이 살아 있어야 한다.
    await recordHeartbeat(
      "DKADV006B", s.token, "1.4.116", undefined, undefined, undefined, undefined,
      { diskTotal: 120 * GB, diskFree: 4 * GB },
    );
    r = await row("DKADV006B");
    expect(r.topDirs).toHaveLength(2);
  });

  // ── disk-07: 모양이 깨진 topDirs 가 heartbeat 를 깨면 안 된다 ──
  //   telemetry 하나 때문에 하트비트가 죽으면 그 기기는 자동 업데이트까지 끊긴다.
  it("disk-07 망가진 topDirs 는 걸러지고 heartbeat 는 200 이다", async () => {
    const s = await seed("disk-adv-07", "DKADV0007");
    const res = await heartbeatPOST(
      hbReq(
        `{"remoteId":"DKADV0007","version":"1.4.116","diskTotal":${120 * GB},` +
          `"diskFree":${4 * GB},"topDirs":[{"name":"ok","bytes":123},` +
          `{"name":123,"bytes":"x"},null,"nope",{"bytes":5}]}`,
        s.token,
      ),
    );
    expect(res.status).toBe(200);
    const r = await row("DKADV0007");
    expect(r.topDirs).toHaveLength(1);
    expect(r.topDirs?.[0].name).toBe("ok");
  });
});
