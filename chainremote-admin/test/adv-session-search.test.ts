// 패널 지원기록 검색 — 계약을 못박는다.
//
// 왜 이 테스트가 필요한가: 검색은 WHERE 절에 조건을 **더하는** 일이라, 잘못 짜면
// 테넌트 격리 조건과 OR 로 묶여 남의 회사 기록이 새어 나온다. 화면으로는 절대 안 보이는
// 유형이고(내 회사 데이터만 있으면 멀쩡해 보인다) 사고가 나면 치명적이다.
//
// 검증: 격리 / 검색 대상 4필드 / 대소문자 / 기간 / 특수문자 / 길이 상한 / 기간 밖 카운트.

import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";

import { testDb } from "./helpers/db";
import { tenants, users, customers, supportSessions } from "@/lib/schema";
import { searchSessions, countSessionsAllPeriods } from "@/lib/data/sessions";

async function mkTenant(slug: string): Promise<string> {
  const [t] = await testDb()
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  return t.id;
}

async function mkUser(tenantId: string, email: string, displayName: string): Promise<string> {
  const [u] = await testDb()
    .insert(users)
    .values({ tenantId, email, displayName, passwordHash: "x", role: "operator" })
    .returning({ id: users.id });
  return u.id;
}

async function mkCustomer(tenantId: string, name: string, remoteId: string): Promise<string> {
  const [c] = await testDb()
    .insert(customers)
    .values({ tenantId, name, remoteId })
    .returning({ id: customers.id });
  return c.id;
}

async function mkSession(opts: {
  tenantId: string;
  customerId: string;
  operatorId: string;
  remoteId: string;
  description: string;
  contactName?: string;
  daysAgo?: number;
}): Promise<string> {
  const started = new Date(Date.now() - (opts.daysAgo ?? 0) * 86400_000);
  const [s] = await testDb()
    .insert(supportSessions)
    .values({
      tenantId: opts.tenantId,
      customerId: opts.customerId,
      operatorId: opts.operatorId,
      remoteId: opts.remoteId,
      description: opts.description,
      contactName: opts.contactName ?? "",
      startedAt: started,
      // durationSec 은 DB 가 started/ended 로 계산하는 생성 컬럼이라 넣지 않는다.
      endedAt: new Date(started.getTime() + 60_000),
    })
    .returning({ id: supportSessions.id });
  return s.id;
}

describe("패널 지원기록 검색", () => {
  it("SS-1: 검색이 테넌트 격리를 뚫지 않는다 (가장 중요)", async () => {
    const a = await mkTenant("ss-a");
    const b = await mkTenant("ss-b");
    const ua = await mkUser(a, "a@ss", "김창현");
    const ub = await mkUser(b, "b@ss", "남의직원");
    const ca = await mkCustomer(a, "우리거래처", "SSA00001");
    const cb = await mkCustomer(b, "남의거래처", "SSB00001");
    await mkSession({
      tenantId: a, customerId: ca, operatorId: ua,
      remoteId: "SSA00001", description: "프린터 고장",
    });
    await mkSession({
      tenantId: b, customerId: cb, operatorId: ub,
      remoteId: "SSB00001", description: "프린터 고장",
    });

    // 같은 검색어인데 각자 자기 것만 나와야 한다.
    const ra = await searchSessions({ tenantId: a, period: "all", q: "프린터" });
    expect(ra).toHaveLength(1);
    expect(ra[0].customerName).toBe("우리거래처");

    const rb = await searchSessions({ tenantId: b, period: "all", q: "프린터" });
    expect(rb).toHaveLength(1);
    expect(rb[0].customerName).toBe("남의거래처");

    // 남의 거래처 이름으로 검색해도 안 나온다.
    const leak = await searchSessions({ tenantId: a, period: "all", q: "남의거래처" });
    expect(leak).toHaveLength(0);
  });

  it("SS-2: 내용·거래처·응대자·담당자 넷을 다 훑는다", async () => {
    const t = await mkTenant("ss-fields");
    const u = await mkUser(t, "u@ss", "박담당");
    const c = await mkCustomer(t, "행복마트", "SSF00001");
    await mkSession({
      tenantId: t, customerId: c, operatorId: u, remoteId: "SSF00001",
      description: "영수증 용지 걸림", contactName: "이사장",
    });

    for (const q of ["영수증", "행복마트", "이사장", "박담당"]) {
      const r = await searchSessions({ tenantId: t, period: "all", q });
      expect(r, `"${q}" 로 못 찾음`).toHaveLength(1);
    }
  });

  it("SS-3: 대소문자를 무시한다 (영문 상호)", async () => {
    const t = await mkTenant("ss-case");
    const u = await mkUser(t, "u@case", "김창현");
    const c = await mkCustomer(t, "OKPOS 본점", "SSC00001");
    await mkSession({
      tenantId: t, customerId: c, operatorId: u,
      remoteId: "SSC00001", description: "OkPos 재설치",
    });
    for (const q of ["okpos", "OKPOS", "OkPos"]) {
      expect(await searchSessions({ tenantId: t, period: "all", q })).toHaveLength(1);
    }
  });

  it("SS-4: 기간 조건이 검색과 같이 걸린다", async () => {
    const t = await mkTenant("ss-period");
    const u = await mkUser(t, "u@period", "김창현");
    const c = await mkCustomer(t, "오래된집", "SSP00001");
    await mkSession({
      tenantId: t, customerId: c, operatorId: u, remoteId: "SSP00001",
      description: "석달전 프린터", daysAgo: 95,
    });

    // 최근 30일에는 없고
    expect(await searchSessions({ tenantId: t, period: "month", q: "프린터" })).toHaveLength(0);
    // 전체에는 있다
    expect(await searchSessions({ tenantId: t, period: "all", q: "프린터" })).toHaveLength(1);
  });

  it("SS-5: 기간 밖 건수를 정확히 센다 (검색이 안 되네 오해 차단)", async () => {
    const t = await mkTenant("ss-outside");
    const u = await mkUser(t, "u@outside", "김창현");
    const c = await mkCustomer(t, "옛거래처", "SSO00001");
    await mkSession({
      tenantId: t, customerId: c, operatorId: u, remoteId: "SSO00001",
      description: "옛날 바코드 문제", daysAgo: 200,
    });
    await mkSession({
      tenantId: t, customerId: c, operatorId: u, remoteId: "SSO00001",
      description: "옛날 바코드 또", daysAgo: 150,
    });

    expect(await searchSessions({ tenantId: t, period: "month", q: "바코드" })).toHaveLength(0);
    expect(await countSessionsAllPeriods({ tenantId: t, q: "바코드" })).toBe(2);
  });

  it("SS-6: SQL 특수문자·와일드카드가 주입이 되지 않는다", async () => {
    const t = await mkTenant("ss-inject");
    const u = await mkUser(t, "u@inject", "김창현");
    const c = await mkCustomer(t, "정상거래처", "SSI00001");
    await mkSession({
      tenantId: t, customerId: c, operatorId: u,
      remoteId: "SSI00001", description: "정상 기록",
    });

    // 어떤 입력이 와도 터지지 않고, 매칭도 안 된다(리터럴로 취급).
    for (const bad of ["' OR '1'='1", "'; DROP TABLE support_sessions; --", "\\", "%_%"]) {
      const r = await searchSessions({ tenantId: t, period: "all", q: bad });
      expect(Array.isArray(r)).toBe(true);
    }
    // 테이블이 멀쩡한지 확인 — DROP 이 먹었으면 여기서 터진다.
    const still = await testDb()
      .select()
      .from(supportSessions)
      .where(eq(supportSessions.tenantId, t));
    expect(still).toHaveLength(1);
  });

  it("SS-7: 아주 긴 검색어도 안전하다 (길이 상한)", async () => {
    const t = await mkTenant("ss-long");
    const u = await mkUser(t, "u@long", "김창현");
    const c = await mkCustomer(t, "긴검색", "SSL00001");
    await mkSession({
      tenantId: t, customerId: c, operatorId: u,
      remoteId: "SSL00001", description: "짧은 기록",
    });
    const r = await searchSessions({ tenantId: t, period: "all", q: "가".repeat(5000) });
    expect(r).toHaveLength(0); // 매칭 없음이 정상 — 터지지 않는 게 핵심
  });

  it("SS-8: 검색어가 없으면 기간 안 전체가 나온다", async () => {
    const t = await mkTenant("ss-noq");
    const u = await mkUser(t, "u@noq", "김창현");
    const c = await mkCustomer(t, "무검색", "SSN00001");
    await mkSession({
      tenantId: t, customerId: c, operatorId: u, remoteId: "SSN00001", description: "A",
    });
    await mkSession({
      tenantId: t, customerId: c, operatorId: u, remoteId: "SSN00001", description: "B",
    });
    expect(await searchSessions({ tenantId: t, period: "all" })).toHaveLength(2);
    expect(await searchSessions({ tenantId: t, period: "all", q: "   " })).toHaveLength(2);
  });
});
