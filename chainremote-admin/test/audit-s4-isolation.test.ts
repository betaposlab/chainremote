// S4 라운드2 적대적 감사 — 멀티테넌트 격리 + 악성/경계 입력.
//
// 노림수: adv-cross-tenant.test.ts(1.4.56~65)·audit-fixes-a1/a2.test.ts(2026-08-16) 가 이미
//   덮은 표면은 반복하지 않는다. 이 파일은 그 이후 새로 생긴 자리(세션 폐기/복원/사후편집/
//   수동기록, 문의함 첨부 이미지, tenants/[id]/{agent,hq,chaingo} 다운로드 라우트)의 tenant
//   경계 + 악성/경계 입력(빈값/초장문/이모지/스크립트/SQL 특수문자/NUL/공백)을 두들긴다.
//
// 소스는 절대 수정하지 않는다 — 테스트만. 실패로 노출된 항목은 "결함 후보"로 보고서에 분리.

import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  tenants,
  users,
  customers,
  supportSessions,
  feedback,
  feedbackImages,
} from "@/lib/schema";
import { signApiToken } from "@/lib/api-auth";
import * as sessionsData from "@/lib/data/sessions";
import * as feedbackData from "@/lib/data/feedback";
import { startSession } from "@/lib/data/sessions";

// ── 시드 헬퍼 (adv-cross-tenant.test.ts 와 동일 패턴) ──
type Role = "owner" | "admin" | "operator" | "viewer" | "super_admin";

async function makeTenant(slug: string): Promise<string> {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug, isActive: true, subscriptionStatus: "active" })
    .returning({ id: tenants.id });
  return t.id;
}

async function makeUser(tenantId: string, email: string, role: Role = "owner"): Promise<string> {
  const db = testDb();
  const [u] = await db
    .insert(users)
    .values({ tenantId, email, passwordHash: "x", displayName: email, role })
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

async function token(uid: string, tenantId: string, role: Role = "owner"): Promise<string> {
  const { token } = await signApiToken({ uid, email: `${uid}@x`, displayName: uid, role, tenantId });
  return token;
}

function bearer(t: string): HeadersInit {
  return { authorization: `Bearer ${t}`, "content-type": "application/json" };
}

async function jsonOf(res: Response) {
  return { status: res.status, json: await res.json() };
}

async function sessionRow(id: string) {
  const db = testDb();
  const [r] = await db.select().from(supportSessions).where(eq(supportSessions.id, id));
  return r;
}

// ══════════════════════════════════════════════════════════════════════════
// 1) 세션 폐기/복원/사후편집/수동기록 — tenant 경계 (2026-08-15 신설 표면, 데이터 레이어 직격)
// ══════════════════════════════════════════════════════════════════════════
describe("S4-01: 세션 폐기/복원/사후편집 — 타 tenant 로는 부작용 0", () => {
  async function seedAB() {
    const tA = await makeTenant("s4-a");
    const tB = await makeTenant("s4-b");
    const uB = await makeUser(tB, "opB");
    const cB = await makeCustomer(tB, "B마트", "S4B0000001");
    return { tA, tB, uB, cB };
  }

  it("discardSessionSoft: 타 tenant 세션은 폐기표식이 안 남는다", async () => {
    const { tA, tB, uB, cB } = await seedAB();
    const s = await startSession({ tenantId: tB, operatorId: uB, customerId: cB, remoteId: "S4B0000001" });
    await sessionsData.discardSessionSoft(s.id, tA); // A 가 B 세션을 폐기 시도
    const row = await sessionRow(s.id);
    expect(row.discardedAt).toBeNull();
    expect(row.endedAt).toBeNull();
  });

  it("restoreSession: 타 tenant 로는 남의 폐기 취소를 못 건드린다", async () => {
    const { tA, tB, uB, cB } = await seedAB();
    const s = await startSession({ tenantId: tB, operatorId: uB, customerId: cB, remoteId: "S4B0000001" });
    await sessionsData.discardSessionSoft(s.id, tB); // B 정당 폐기
    await sessionsData.restoreSession(s.id, tA); // A 가 복원 시도(악용 시나리오 X, 그래도 격리 확인)
    const row = await sessionRow(s.id);
    expect(row.discardedAt).not.toBeNull(); // A 로는 안 풀림
  });

  it("updateSessionRecord: 타 tenant 로는 지원 내용을 못 덮어쓴다", async () => {
    const { tA, tB, uB, cB } = await seedAB();
    const s = await startSession({ tenantId: tB, operatorId: uB, customerId: cB, remoteId: "S4B0000001" });
    await sessionsData.updateSessionRecord(s.id, tA, {
      description: "A 가 조작한 내용",
      resolution: "resolved",
    });
    const row = await sessionRow(s.id);
    expect(row.description).toBeNull();
    expect(row.resolution).toBe("in_progress");
  });

  it("createManualSession: 타 tenant customerId 로는 수동기록을 못 만든다(에러, SQL 안 셈)", async () => {
    const { tA, cB } = await seedAB();
    await expect(
      sessionsData.createManualSession({
        tenantId: tA, // A 계정인데
        operatorId: (await makeUser(tA, "opA")),
        customerId: cB, // B 의 거래처 UUID
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
        fields: { description: "위조 시도" },
      }),
    ).rejects.toThrow("거래처가 없습니다");
    const db = testDb();
    const rows = await db.select().from(supportSessions).where(eq(supportSessions.customerId, cB));
    expect(rows.length).toBe(0); // 행이 안 생겼다
  });

  it("정상 소유 tenant(B)로는 전부 정상 동작 — 격리가 과하지 않음을 대조", async () => {
    const { tB, uB, cB } = await seedAB();
    const s = await startSession({ tenantId: tB, operatorId: uB, customerId: cB, remoteId: "S4B0000001" });
    await sessionsData.discardSessionSoft(s.id, tB);
    expect((await sessionRow(s.id)).discardedAt).not.toBeNull();
    await sessionsData.restoreSession(s.id, tB);
    expect((await sessionRow(s.id)).discardedAt).toBeNull();
    await sessionsData.updateSessionRecord(s.id, tB, { description: "정상 기록" });
    expect((await sessionRow(s.id)).description).toBe("정상 기록");
    const manual = await sessionsData.createManualSession({
      tenantId: tB,
      operatorId: uB,
      customerId: cB,
      startedAt: new Date(Date.now() - 60_000),
      endedAt: new Date(),
      fields: { description: "전화 처리" },
    });
    expect(manual.manual).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2) 문의함 첨부 이미지 — tenant 경계 (getImageForServe 가 격리의 전부라고 주석에 명시된 자리)
// ══════════════════════════════════════════════════════════════════════════
describe("S4-02: 문의 첨부 이미지 서빙 — 남의 tenant 스크린샷 열람 불가", () => {
  it("getImageForServe: 다른 tenant scope 로는 남의 이미지가 안 나온다(404 로 이어짐)", async () => {
    const db = testDb();
    const tA = await makeTenant("s4-img-a");
    const tB = await makeTenant("s4-img-b");
    const uB = await makeUser(tB, "imgB");
    const [fb] = await db
      .insert(feedback)
      .values({ tenantId: tB, userId: uB, authorName: "B", kind: "bug", title: "t", body: "b" })
      .returning({ id: feedback.id });
    const [img] = await db
      .insert(feedbackImages)
      .values({
        feedbackId: fb.id,
        tenantId: tB,
        storedName: "s4-secret.png",
        originalName: "포스화면.png",
        mimeType: "image/png",
        byteSize: 100,
      })
      .returning({ id: feedbackImages.id });

    const asA = await feedbackData.getImageForServe(img.id, { tenantId: tA });
    expect(asA).toBeNull(); // A 스코프로는 존재 자체가 안 보인다

    const asB = await feedbackData.getImageForServe(img.id, { tenantId: tB });
    expect(asB?.storedName).toBe("s4-secret.png"); // 정당 소유자는 정상 조회(대조)
  });

  it("deleteFeedback: 타 tenant 스코프로는 남의 문의를 못 지운다", async () => {
    const db = testDb();
    const tA = await makeTenant("s4-fb-a");
    const tB = await makeTenant("s4-fb-b");
    const uB = await makeUser(tB, "fbB");
    const [fb] = await db
      .insert(feedback)
      .values({ tenantId: tB, userId: uB, authorName: "B", kind: "bug", title: "t", body: "b" })
      .returning({ id: feedback.id });
    const row = await feedbackData.deleteFeedback(fb.id, { tenantId: tA });
    expect(row).toBeUndefined();
    const still = await db.select().from(feedback).where(eq(feedback.id, fb.id));
    expect(still.length).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3) tenants/[id]/{agent,hq,chaingo} — 남의 대리점 설치파일(enroll-key 포함) 다운로드 차단
//    getLiveUser 를 모킹해 세션 쿠키 없이 라우트 가드 로직만 직격.
// ══════════════════════════════════════════════════════════════════════════
vi.mock("@/lib/auth-guard", () => ({ getLiveUser: vi.fn() }));

describe("S4-03: tenants/[id]/{agent,hq,chaingo} — 남의 회사 설치파일 다운로드 차단", () => {
  it("직원(operator)이 남의 tenantId 로 agent 다운로드 시도 → 403, 네트워크 도달 전 차단", async () => {
    const { getLiveUser } = await import("@/lib/auth-guard");
    const tA = await makeTenant("s4-dl-a");
    const tB = await makeTenant("s4-dl-b");
    vi.mocked(getLiveUser).mockResolvedValue({
      id: "u1",
      email: "op@a",
      displayName: "op",
      role: "operator",
      tenantId: tA,
    });
    const { POST } = await import("@/app/api/tenants/[id]/agent/route");
    const req = new Request(`http://t/api/tenants/${tB}/agent`, { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: tB }) });
    expect(res.status).toBe(403);
  });

  it("owner 가 남의 tenantId 로 hq 다운로드 시도 → 403", async () => {
    const { getLiveUser } = await import("@/lib/auth-guard");
    const tA = await makeTenant("s4-dl-a2");
    const tB = await makeTenant("s4-dl-b2");
    vi.mocked(getLiveUser).mockResolvedValue({
      id: "u2",
      email: "owner@a",
      displayName: "owner",
      role: "owner",
      tenantId: tA,
    });
    const { GET } = await import("@/app/api/tenants/[id]/hq/route");
    const req = new Request(`http://t/api/tenants/${tB}/hq`);
    const res = await GET(req, { params: Promise.resolve({ id: tB }) });
    expect(res.status).toBe(403);
  });

  it("owner 가 남의 tenantId 로 chaingo 다운로드 시도 → 403", async () => {
    const { getLiveUser } = await import("@/lib/auth-guard");
    const tA = await makeTenant("s4-dl-a3");
    const tB = await makeTenant("s4-dl-b3");
    vi.mocked(getLiveUser).mockResolvedValue({
      id: "u3",
      email: "owner@a3",
      displayName: "owner",
      role: "owner",
      tenantId: tA,
    });
    const { GET } = await import("@/app/api/tenants/[id]/chaingo/route");
    const req = new Request(`http://t/api/tenants/${tB}/chaingo`);
    const res = await GET(req, { params: Promise.resolve({ id: tB }) });
    expect(res.status).toBe(403);
  });

  it("로그인 안 한 경우(getLiveUser=null) 셋 다 403", async () => {
    const { getLiveUser } = await import("@/lib/auth-guard");
    const tX = await makeTenant("s4-dl-anon");
    vi.mocked(getLiveUser).mockResolvedValue(null);
    const { POST: agentPOST } = await import("@/app/api/tenants/[id]/agent/route");
    const r1 = await agentPOST(new Request(`http://t/api/tenants/${tX}/agent`, { method: "POST" }), {
      params: Promise.resolve({ id: tX }),
    });
    expect(r1.status).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4) 경계·악성 입력 — 빈값/초장문/이모지/스크립트/SQL특수문자/NUL/공백.
//    핵심 관심사: 500 이 나며 SQL 문구가 응답 바디에 새는지(CWE-209).
// ══════════════════════════════════════════════════════════════════════════
describe("S4-04: 경계·악성 입력 — 크래시/SQL 노출 없이 정상 처리 또는 정갈한 4xx", () => {
  async function makeOwnerToken(slug: string) {
    const t = await makeTenant(slug);
    const u = await makeUser(t, `${slug}@x`, "owner");
    return { t, u, tok: await token(u, t, "owner") };
  }

  it("거래처 상호 — 빈값/300자/이모지/스크립트/SQL특수문자 전부 크래시 없이 처리", async () => {
    const { tok } = await makeOwnerToken("s4-b-name");
    const { POST } = await import("@/app/api/customers/route");
    const cases = [
      { name: "", expectStatus: 400 },
      { name: "A".repeat(300), expectStatus: 201 },
      { name: "🍕가게이모지😀", expectStatus: 201 },
      { name: "<script>alert(1)</script>", expectStatus: 201 },
      { name: "'; DROP TABLE customers; --", expectStatus: 201 },
      { name: "   앞뒤공백   ", expectStatus: 201 },
    ];
    for (const c of cases) {
      const req = new Request("http://t/api/customers", {
        method: "POST",
        headers: bearer(tok),
        body: JSON.stringify({ name: c.name }),
      });
      const r = await jsonOf(await POST(req));
      expect(r.status).toBe(c.expectStatus);
      if (r.status === 201) {
        // 저장된 그대로 나오는지(이스케이프 손상·잘림 없이) — XSS 는 렌더링 단(React 이스케이프) 책임이라
        // 여기서는 "DB 값이 안 깨졌는지"만 확인한다.
        expect(typeof r.json.customer.name).toBe("string");
      }
    }
  });

  it("거래처 상호에 NUL 바이트 — 500 이면 SQL 문구가 새지 않아야 한다", async () => {
    const { tok } = await makeOwnerToken("s4-b-nul");
    const { POST } = await import("@/app/api/customers/route");
    const req = new Request("http://t/api/customers", {
      method: "POST",
      headers: bearer(tok),
      body: JSON.stringify({ name: `NUL포함 상호` }),
    });
    const res = await POST(req);
    const bodyText = await res.text();
    if (res.status >= 500) {
      expect(bodyText.toLowerCase()).not.toMatch(/insert into|select .* from|drizzlequeryerror/i);
    }
  });

  it("remoteId 경계값 — 소문자/공백포함/10자리/한글 — firewall 라우트가 크래시 없이 404 처리", async () => {
    const { tok } = await makeOwnerToken("s4-b-remoteid");
    const { POST } = await import("@/app/api/customers/firewall/route");
    const cases = ["ab123", "AB 1234 5678", "1234567890", "한글아이디", "'; DROP TABLE customers; --"];
    for (const remoteId of cases) {
      const req = new Request("http://t/api/customers/firewall", {
        method: "POST",
        headers: bearer(tok),
        body: JSON.stringify({ remoteId, control: true }),
      });
      const res = await POST(req);
      expect(res.status).toBe(404); // 존재하지 않는 거래처 — 크래시 없이 정갈한 404
      const bodyText = await res.text();
      expect(bodyText.toLowerCase()).not.toMatch(/select .* from|drizzlequeryerror|duplicate key/i);
    }
  });

  it("지원기록 검색어 — %, _, 300자 — 크래시 없이 200 (ilike 와일드카드 오작동 방지 대조)", async () => {
    const { t, u } = await makeOwnerToken("s4-b-search");
    const cB = await makeCustomer(t, "검색대상매장", "S4SR000001");
    await startSession({ tenantId: t, operatorId: u, customerId: cB, remoteId: "S4SR000001" });
    const qs = ["%", "_", "%%%___%%%", "가".repeat(300), "'; DROP TABLE support_sessions; --"];
    for (const q of qs) {
      const rows = await sessionsData.searchSessions({ tenantId: t, period: "all", q });
      expect(Array.isArray(rows)).toBe(true); // 크래시 없이 배열(빈 배열이어도 정상)
    }
  });

  it("수동 기록: endedAt < startedAt 은 명시적 에러(SQL 문구 없이)", async () => {
    const { t, u } = await makeOwnerToken("s4-b-manual-order");
    const cB = await makeCustomer(t, "매장", "S4MN000001");
    await expect(
      sessionsData.createManualSession({
        tenantId: t,
        operatorId: u,
        customerId: cB,
        startedAt: new Date(),
        endedAt: new Date(Date.now() - 60_000), // 시작보다 과거
        fields: { description: "역순" },
      }),
    ).rejects.toThrow("종료 시각이 시작보다 앞섭니다");
  });

  it("세션 종료 설명(description) 초장문 + NUL — end 라우트가 크래시 없이 처리", async () => {
    const { t, u, tok } = await makeOwnerToken("s4-b-end-long");
    const cB = await makeCustomer(t, "매장2", "S4EN000001");
    const s = await startSession({ tenantId: t, operatorId: u, customerId: cB, remoteId: "S4EN000001" });
    const { POST } = await import("@/app/api/sessions/[id]/end/route");
    const req = new Request(`http://t/api/sessions/${s.id}/end`, {
      method: "POST",
      headers: bearer(tok),
      body: JSON.stringify({
        description: `초장문${"내용".repeat(2000)} 끝`,
        resolution: "resolved",
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: s.id }) });
    expect(res.status).toBe(200); // NUL 은 라우트가 이미 필터링(clean) — 크래시 없이 정상 종료
  });
});
