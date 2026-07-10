import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { registerHeartbeatToken, recordHeartbeat } from "@/lib/data/customers";
import { tenants, customers } from "@/lib/schema";

// arch(마이그 020) — 거래처 프로세스 arch(x86/x64) 저장. 순수 표시·진단 telemetry 라
//   ★신원/매칭 키가 절대 아니다(machine_uuid 와 결정적 차이). 이 테스트가 그 계약을 못박는다:
//   유효한 arch 만 저장 / 미보고·이상값은 기존값 보존 / arch 는 매칭에 안 쓰인다(토큰만).

async function seed(slug: string, name: string, remoteId: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  const [c] = await db
    .insert(customers)
    .values({ tenantId: t.id, name, remoteId })
    .returning({ id: customers.id });
  const token = await registerHeartbeatToken(remoteId); // ★remoteId 로 발급(customerId 아님)
  return { tenantId: t.id, customerId: c.id, token: token! };
}

async function readArch(remoteId: string): Promise<string | null> {
  const db = testDb();
  const [row] = await db
    .select({ arch: customers.arch })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return row?.arch ?? null;
}

describe("heartbeat arch (마이그 020)", () => {
  it("유효한 arch(x86/x64)를 저장한다", async () => {
    const { token } = await seed("arch-a", "봉스푸드", "GN11110001");
    expect(await recordHeartbeat("GN11110001", token, "1.4.53", undefined, "x86")).toBe(true);
    expect(await readArch("GN11110001")).toBe("x86");

    expect(await recordHeartbeat("GN11110001", token, "1.4.53", undefined, "x64")).toBe(true);
    expect(await readArch("GN11110001")).toBe("x64");
  });

  it("arch 미보고(구버전 에이전트)는 기존 arch 를 건드리지 않는다", async () => {
    const { token } = await seed("arch-b", "카페리치", "FC22220002");
    await recordHeartbeat("FC22220002", token, "1.4.53", undefined, "x86");
    expect(await readArch("FC22220002")).toBe("x86");

    // 다음 heartbeat 가 arch 를 안 보냄(undefined) → x86 이 지워지면 안 된다.
    expect(await recordHeartbeat("FC22220002", token, "1.4.53", undefined, undefined)).toBe(true);
    expect(await readArch("FC22220002")).toBe("x86");
  });

  it("이상한 arch 값은 무시한다(저장 안 함, 기존값 보존)", async () => {
    const { token } = await seed("arch-c", "신교령", "GN33330003");
    // 첫 보고: 정상 x64
    await recordHeartbeat("GN33330003", token, "1.4.53", undefined, "x64");
    // 오염된 값 → 무시(x64 유지)
    expect(await recordHeartbeat("GN33330003", token, "1.4.53", undefined, "arm64"))
      .toBe(true);
    expect(await readArch("GN33330003")).toBe("x64");
    // 빈 문자열도 무시
    await recordHeartbeat("GN33330003", token, "1.4.53", undefined, "");
    expect(await readArch("GN33330003")).toBe("x64");
  });

  it("arch 는 매칭 키가 아니다 — 토큰이 틀리면 arch 도 안 써지고 heartbeat 자체가 실패", async () => {
    await seed("arch-d", "복수점", "GN44440004");
    // 잘못된 토큰 → recordHeartbeat 는 false, arch 도 반영 안 됨.
    expect(await recordHeartbeat("GN44440004", "wrong-token", "1.4.53", undefined, "x86")).toBe(false);
    expect(await readArch("GN44440004")).toBeNull();
  });
});
