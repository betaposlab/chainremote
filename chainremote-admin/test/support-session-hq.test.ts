import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  startSession,
  endSession,
  discardSession,
  listCustomerSessions,
  listRecentSessions,
} from "@/lib/data/sessions";
import { tenants, users, customers, supportSessions } from "@/lib/schema";
import { signApiToken } from "@/lib/api-auth";
import { POST as startSessionRoute } from "@/app/api/sessions/route";

// HQ 지원세션 기록 — 종료 시 duration 자동계산 + 선택필드(응대자·종류·내용·처리결과) 저장,
//   전부 선택적(안 적으면 빈 채로), per-거래처/전체 조회. Phase 1 백엔드 계약을 못박는다.

async function seed() {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug: "hqsess", displayName: "hqsess" })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({
      tenantId: t.id,
      email: "op1",
      displayName: "재성",
      passwordHash: "x",
      role: "operator",
    })
    .returning({ id: users.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name: "도덕봉가든", remoteId: "323608526" })
    .returning({ id: customers.id });
  return { tenantId: t.id, operatorId: u.id, customerId: c.id };
}

async function row(id: string) {
  const db = testDb();
  const [r] = await db
    .select()
    .from(supportSessions)
    .where(eq(supportSessions.id, id))
    .limit(1);
  return r;
}

describe("HQ 지원세션 기록 (Phase 1)", () => {
  it("종료 시 선택필드 저장 + duration 계산", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "323608526",
    });
    await endSession(sess.id, s.tenantId, {
      categories: "printer,payment",
      description: "영수증 프린터 재설정 + 카드단말 재연결",
      contactName: "김점장",
      resolution: "resolved",
    });
    const r = await row(sess.id);
    expect(r.endedAt).not.toBeNull();
    expect(r.durationSec).not.toBeNull();
    expect(r.durationSec! >= 0).toBe(true);
    expect(r.categories).toBe("printer,payment");
    expect(r.description).toContain("프린터");
    expect(r.contactName).toBe("김점장");
    expect(r.resolution).toBe("resolved");
  });

  it("★필드 전부 생략(스킵)해도 종료·duration 은 남고 나머지는 null", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "323608526",
    });
    await endSession(sess.id, s.tenantId); // 아무 필드 없이
    const r = await row(sess.id);
    expect(r.endedAt).not.toBeNull();
    expect(r.durationSec).not.toBeNull();
    expect(r.categories).toBeNull();
    expect(r.contactName).toBeNull();
  });

  it("per-거래처 + 전체 타임라인 조회", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "323608526",
    });
    await endSession(sess.id, s.tenantId, { description: "점검" });

    const perCust = await listCustomerSessions(s.customerId, s.tenantId);
    expect(perCust.length).toBe(1);
    expect(perCust[0].operatorName).toBe("재성"); // 우리측 담당자 자동

    const timeline = await listRecentSessions(s.tenantId);
    expect(timeline.length).toBe(1);
    expect(timeline[0].customer?.name).toBe("도덕봉가든");
  });

  it("짧은 오접속은 discard 로 삭제", async () => {
    const s = await seed();
    const sess = await startSession({
      tenantId: s.tenantId,
      operatorId: s.operatorId,
      customerId: s.customerId,
      remoteId: "323608526",
    });
    await discardSession(sess.id, s.tenantId);
    expect(await row(sess.id)).toBeUndefined();
  });
});

describe("POST /api/sessions — remoteId 시작 + 내부기기/미등록 스킵", () => {
  async function bearer(s: { tenantId: string; operatorId: string }) {
    const { token } = await signApiToken(
      {
        uid: s.operatorId,
        email: "op1",
        displayName: "재성",
        role: "operator",
        tenantId: s.tenantId,
      },
      "22222222-2222-2222-2222-222222222222",
    );
    return token;
  }
  async function post(token: string, remoteId: string) {
    const req = new Request("http://t/api/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ remoteId }),
    });
    const res = await startSessionRoute(req);
    return { status: res.status, json: await res.json() };
  }

  it("정상 거래처 → 세션 생성(sessionId 반환)", async () => {
    const s = await seed();
    const r = await post(await bearer(s), "323608526");
    expect(r.status).toBe(201);
    expect(typeof r.json.sessionId).toBe("string");
  });

  it("★내부기기(is_internal) → 기록 안 함(skipped:internal)", async () => {
    const s = await seed();
    const db = testDb();
    await db
      .insert(customers)
      .values({
        tenantId: s.tenantId,
        name: "내 맥북",
        remoteId: "445497547",
        isInternal: true,
      });
    const r = await post(await bearer(s), "445497547");
    expect(r.json.sessionId).toBeNull();
    expect(r.json.skipped).toBe("internal");
  });

  it("미등록 peer → 기록 안 함(skipped:unknown)", async () => {
    const s = await seed();
    const r = await post(await bearer(s), "999999999");
    expect(r.json.sessionId).toBeNull();
    expect(r.json.skipped).toBe("unknown");
  });
});
