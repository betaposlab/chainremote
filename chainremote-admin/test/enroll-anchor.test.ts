import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { enrollCustomer } from "@/lib/data/customers";
import { tenants, customers } from "@/lib/schema";

// ★ 2026-07-07 실사고 회귀 테스트.
// POS 업체가 윈도우 이미지를 클론해 여러 대에 깔면 machine_uuid(MachineGuid)가 겹친다.
// 옛 enroll 앵커는 지문이 겹치면 "같은 기계"로 오인해 남의 거래처 remote_id 를 덮어써
// 레코드를 가로챘다(행복정육식당↔5.5춘천닭갈비, 준코↔처갓집). 앵커를 껐으니 이제
// 지문이 겹쳐도 절대 남의 레코드를 안 건드리고 각자 새 레코드로 뜬다. 이 테스트가
// 빨개지면 = 누군가 앵커를 되살렸다는 경보.

async function makeTenant(slug: string): Promise<string> {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  return t.id;
}

describe("enroll 앵커 — 지문 충돌 가로채기 금지", () => {
  it("서로 다른 기계가 같은 machineUuid 여도 첫 레코드를 안 덮고 별도 생성", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");

    // 기계 A: 행복정육식당 (지문 SHARED-FP)
    const a = await enrollCustomer(
      { remoteId: "GN61428928", name: "행복정육식당", machineUuid: "SHARED-FP" },
      { tenantId: tid },
    );
    expect(a).not.toBe("cross_tenant");

    // 기계 B: 5.5춘천닭갈비 (다른 ID, 같은 지문) — 클론 이미지라 지문 겹침
    const b = await enrollCustomer(
      { remoteId: "GN57607738", name: "5.5춘천닭갈비", machineUuid: "SHARED-FP" },
      { tenantId: tid },
    );
    expect(b).not.toBe("cross_tenant");

    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.tenantId, tid));

    // 두 레코드가 따로 존재
    expect(rows.length).toBe(2);
    // ★ 행복정육식당의 remoteId 가 안 덮였다 (가로채기 없음)
    const hbp = rows.find((r) => r.name === "행복정육식당");
    expect(hbp?.remoteId).toBe("GN61428928");
    const chuncheon = rows.find((r) => r.name === "5.5춘천닭갈비");
    expect(chuncheon?.remoteId).toBe("GN57607738");
    // ★ 앵커 비활성 확인 — 지문은 저장조차 안 된다(재오염 원천 차단)
    expect(hbp?.machineUuid).toBeNull();
    expect(chuncheon?.machineUuid).toBeNull();
  });

  it("같은 remoteId 재enroll 은 새 레코드를 안 만들고 토큰만 회전", async () => {
    const db = testDb();
    const tid = await makeTenant("betapos");
    const first = await enrollCustomer(
      { remoteId: "AB11112222", name: "재설치테스트" },
      { tenantId: tid },
    );
    const second = await enrollCustomer(
      { remoteId: "AB11112222", name: "재설치테스트" },
      { tenantId: tid },
    );
    expect(first).not.toBe("cross_tenant");
    expect(second).not.toBe("cross_tenant");
    if (first !== "cross_tenant" && second !== "cross_tenant") {
      expect(first.created).toBe(true);
      expect(second.created).toBe(false); // 재enroll = 기존 매칭
      expect(second.token).not.toBe(first.token); // 토큰 회전
    }
    const rows = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, "AB11112222"));
    expect(rows.length).toBe(1); // 중복 없음
  });

  it("다른 tenant 가 이미 쓰는 remoteId 는 cross_tenant 로 거부(전역 unique)", async () => {
    const t1 = await makeTenant("tenant-a");
    const t2 = await makeTenant("tenant-b");
    await enrollCustomer({ remoteId: "AB99998888" }, { tenantId: t1 });
    const dup = await enrollCustomer({ remoteId: "AB99998888" }, { tenantId: t2 });
    expect(dup).toBe("cross_tenant");
  });
});
