// 디스크 관제 + 원격 Temp 정리 (마이그 024) — heartbeat 보고/명령 큐 왕복 검증.
// 계약: 디스크 값은 표시용 telemetry(매칭 키 아님), 이상값은 기존값 보존.
// 정리 흐름: requestCleanup → getCleanupRequest 가 응답에 실림 → 에이전트가
// cleanupResult 를 보고하면 결과 저장 + 요청 큐 클리어(재실행 방지).

import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  registerHeartbeatToken,
  recordHeartbeat,
  requestCleanup,
  getCleanupRequest,
} from "@/lib/data/customers";
import { tenants, customers } from "@/lib/schema";

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
  const token = await registerHeartbeatToken(remoteId);
  return { tenantId: t.id, customerId: c.id, token: token! };
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

const GB = 1024 ** 3;

describe("디스크 관제 (마이그 024)", () => {
  it("heartbeat 가 디스크 용량을 보고하면 저장한다 (tempBytes 는 선택)", async () => {
    const { token } = await seed("disk-a", "정안종합식품", "DK11110001");
    const ok = await recordHeartbeat(
      "DK11110001", token, "1.4.59", undefined, undefined, undefined, undefined,
      { diskTotal: 120 * GB, diskFree: 4 * GB, tempBytes: 11 * GB },
    );
    expect(ok).toBe(true);
    const r = await row("DK11110001");
    expect(r.diskTotalBytes).toBe(120 * GB);
    expect(r.diskFreeBytes).toBe(4 * GB);
    expect(r.tempBytes).toBe(11 * GB);
    expect(r.diskReportedAt).not.toBeNull();
  });

  it("이상값(음수/누락)은 기존값을 보존한다", async () => {
    const { token } = await seed("disk-b", "부엌", "DK11110002");
    await recordHeartbeat(
      "DK11110002", token, "1.4.59", undefined, undefined, undefined, undefined,
      { diskTotal: 120 * GB, diskFree: 40 * GB },
    );
    // free 만 오거나 음수면 무시 — 쌍으로 유효할 때만 갱신.
    await recordHeartbeat(
      "DK11110002", token, "1.4.59", undefined, undefined, undefined, undefined,
      { diskFree: 1 * GB },
    );
    await recordHeartbeat(
      "DK11110002", token, "1.4.59", undefined, undefined, undefined, undefined,
      { diskTotal: -5, diskFree: -5 },
    );
    const r = await row("DK11110002");
    expect(r.diskFreeBytes).toBe(40 * GB);
  });

  it("정리 명령 왕복: 요청 → 응답 탑재 → 결과 보고 시 저장+큐 클리어", async () => {
    const s = await seed("disk-c", "간이역", "DK11110003");

    // 요청 전엔 응답에 안 실림
    expect(await getCleanupRequest("DK11110003")).toBeNull();

    // [정리] 버튼
    expect(await requestCleanup("DK11110003", { tenantId: s.tenantId })).toBe(true);
    const queued = await getCleanupRequest("DK11110003");
    expect(queued).not.toBeNull();

    // 에이전트가 실행 후 결과 보고 (heartbeat 에 실어서). 완료 시각(at)은 요청보다 나중이어야
    //   정상 흐름(요청→실행→완료) — 이때만 요청 큐가 비워진다. 완료가 요청보다 과거면 그건
    //   stale 보고라 뒤늦게 도착해 더 새로운 재요청을 지우지 않는다(adv disk-01 방어).
    const result = JSON.stringify({
      freedBytes: 12 * GB, deleted: 31204, skipped: 8, at: new Date(Date.now() + 1000).toISOString(),
    });
    await recordHeartbeat(
      "DK11110003", s.token, "1.4.59", undefined, undefined, undefined, undefined,
      { cleanupResult: result },
    );

    const r = await row("DK11110003");
    expect(r.cleanupResult).toBe(result); // 결과 저장
    expect(r.cleanupRequestedAt).toBeNull(); // 큐 클리어 — 재실행 방지
    expect(await getCleanupRequest("DK11110003")).toBeNull();
  });

  it("타 tenant 의 requestCleanup 은 거절된다", async () => {
    await seed("disk-d", "가게", "DK11110004");
    const db = testDb();
    const [other] = await db
      .insert(tenants)
      .values({ slug: "disk-e", displayName: "disk-e" })
      .returning({ id: tenants.id });
    expect(await requestCleanup("DK11110004", { tenantId: other.id })).toBe(false);
  });
});
