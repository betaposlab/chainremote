import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { registerHeartbeatToken, recordHeartbeat } from "@/lib/data/customers";
import { tenants, customers } from "@/lib/schema";

// NAT 유형(마이그 039) — 0=미상 1=Cone(홀펀칭 가능) 2=Symmetric(포트 예측 불가 → 서버 경유).
//
// 이 값은 "왜 이 거래처는 릴레이만 타나"를 짐작 대신 세기 위한 것이라, 오염되면 존재 이유가
//   사라진다(잘못된 분포를 보고 UPnP 착수 여부를 정하게 된다). arch(020) 와 같은 계약을 건다:
//   화이트리스트 밖 값은 저장 안 함 / 미보고는 기존값 보존 / 매칭 키가 아니다.

async function seed(slug: string, name: string, remoteId: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  await db.insert(customers).values({ tenantId: t.id, name, remoteId });
  const token = await registerHeartbeatToken(remoteId);
  return { tenantId: t.id, token: token! };
}

async function readNat(remoteId: string): Promise<number | null> {
  const db = testDb();
  const [row] = await db
    .select({ natType: customers.natType })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return row?.natType ?? null;
}

describe("heartbeat NAT 유형 (마이그 039)", () => {
  it("0/1/2 를 저장한다", async () => {
    const { token } = await seed("nat-a", "뒷고기", "GN11110001");
    for (const v of [1, 2, 0]) {
      expect(
        await recordHeartbeat("GN11110001", token, "1.4.103", undefined, undefined, undefined, undefined, {
          natType: v,
        }),
      ).toBe(true);
      expect(await readNat("GN11110001")).toBe(v);
    }
  });

  it("도입 전(구버전 에이전트)에는 NULL 로 남는다 — 0(미상)과 구분된다", async () => {
    // NULL 과 0 을 뭉개면 "판정에 실패한 기기"와 "아직 안 올라온 기기"가 섞여
    //   분모가 오염된다. 패널 카드도 NULL 을 분모에서 뺀다.
    const { token } = await seed("nat-b", "옛에이전트", "GN22220002");
    expect(await recordHeartbeat("GN22220002", token, "1.4.102")).toBe(true);
    expect(await readNat("GN22220002")).toBeNull();
  });

  it("보고를 멈춰도 기존 유형이 지워지지 않는다", async () => {
    const { token } = await seed("nat-c", "낭성관리포스", "GN33330003");
    await recordHeartbeat("GN33330003", token, "1.4.103", undefined, undefined, undefined, undefined, {
      natType: 2,
    });
    // 다음 heartbeat 가 natType 을 안 실어 보냄(다운그레이드/일시 누락) → Symmetric 유지.
    await recordHeartbeat("GN33330003", token, "1.4.103");
    expect(await readNat("GN33330003")).toBe(2);
  });

  it("화이트리스트 밖 값은 통째로 무시한다(기존값 보존)", async () => {
    const { token } = await seed("nat-d", "이상치", "GN44440004");
    await recordHeartbeat("GN44440004", token, "1.4.103", undefined, undefined, undefined, undefined, {
      natType: 1,
    });
    for (const bad of [3, -1, 99, 1.5]) {
      await recordHeartbeat("GN44440004", token, "1.4.103", undefined, undefined, undefined, undefined, {
        natType: bad,
      });
      expect(await readNat("GN44440004")).toBe(1);
    }
  });

  it("숫자가 아닌 값도 무시한다", async () => {
    const { token } = await seed("nat-e", "문자열", "GN55550005");
    await recordHeartbeat("GN55550005", token, "1.4.103", undefined, undefined, undefined, undefined, {
      natType: 2,
    });
    await recordHeartbeat("GN55550005", token, "1.4.103", undefined, undefined, undefined, undefined, {
      // 라우트가 걸러주지만 데이터 레이어도 스스로 막는지 확인(직접 호출 경로).
      natType: "2" as unknown as number,
    });
    expect(await readNat("GN55550005")).toBe(2);
  });

  it("★매칭 키가 아니다 — 토큰이 틀리면 heartbeat 자체가 실패하고 유형도 안 써진다", async () => {
    await seed("nat-f", "남의거래처", "GN66660006");
    expect(
      await recordHeartbeat("GN66660006", "wrong-token", "1.4.103", undefined, undefined, undefined, undefined, {
        natType: 1,
      }),
    ).toBe(false);
    expect(await readNat("GN66660006")).toBeNull();
  });
});
