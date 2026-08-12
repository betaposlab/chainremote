import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { registerHeartbeatToken, recordHeartbeat } from "@/lib/data/customers";
import { tenants, customers } from "@/lib/schema";

// 공유기 UPnP 조사 결과(마이그 040) — 'no'|'found'|'yes' 만 저장한다.
//
// 이 값으로 "포트 매핑 본체를 만들 가치가 있는가"를 정하므로, 오염되면 존재 이유가 사라진다.
//   NAT 유형(039)과 같은 계약을 건다: 화이트리스트 밖은 무시 / 미보고는 기존값 보존 / 매칭 키 아님.

async function seed(slug: string, remoteId: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  await db.insert(customers).values({ tenantId: t.id, name: slug, remoteId });
  const token = await registerHeartbeatToken(remoteId);
  return token!;
}

async function readUpnp(remoteId: string): Promise<string | null> {
  const db = testDb();
  const [row] = await db
    .select({ upnp: customers.upnp })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return row?.upnp ?? null;
}

describe("heartbeat UPnP 조사 (마이그 040)", () => {
  it("no / found / yes 를 저장한다", async () => {
    const token = await seed("upnp-a", "GN11110001");
    for (const v of ["no", "found", "yes"]) {
      expect(
        await recordHeartbeat("GN11110001", token, "1.4.107", undefined, undefined, undefined, undefined, {
          upnp: v,
        }),
      ).toBe(true);
      expect(await readUpnp("GN11110001")).toBe(v);
    }
  });

  it("구버전(미보고)은 NULL 로 남는다 — 'no' 와 구분된다", async () => {
    // "UPnP 가 없다"와 "아직 안 재봤다"를 뭉개면 분모가 오염된다.
    const token = await seed("upnp-b", "GN22220002");
    expect(await recordHeartbeat("GN22220002", token, "1.4.106")).toBe(true);
    expect(await readUpnp("GN22220002")).toBeNull();
  });

  it("보고를 멈춰도 기존 값이 지워지지 않는다", async () => {
    const token = await seed("upnp-c", "GN33330003");
    await recordHeartbeat("GN33330003", token, "1.4.107", undefined, undefined, undefined, undefined, {
      upnp: "yes",
    });
    await recordHeartbeat("GN33330003", token, "1.4.107");
    expect(await readUpnp("GN33330003")).toBe("yes");
  });

  it("화이트리스트 밖 값은 무시한다", async () => {
    const token = await seed("upnp-d", "GN44440004");
    await recordHeartbeat("GN44440004", token, "1.4.107", undefined, undefined, undefined, undefined, {
      upnp: "no",
    });
    for (const bad of ["", "maybe", "YES", "1"]) {
      await recordHeartbeat("GN44440004", token, "1.4.107", undefined, undefined, undefined, undefined, {
        upnp: bad,
      });
      expect(await readUpnp("GN44440004")).toBe("no");
    }
  });

  it("★매칭 키가 아니다 — 토큰이 틀리면 저장되지 않는다", async () => {
    await seed("upnp-e", "GN55550005");
    expect(
      await recordHeartbeat("GN55550005", "wrong", "1.4.107", undefined, undefined, undefined, undefined, {
        upnp: "yes",
      }),
    ).toBe(false);
    expect(await readUpnp("GN55550005")).toBeNull();
  });
});
