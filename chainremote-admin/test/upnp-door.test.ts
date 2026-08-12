import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  registerHeartbeatToken,
  recordHeartbeat,
  setUpnpEnabled,
  listCustomers,
  getWatchState,
} from "@/lib/data/customers";
import {
  probeUpnpDoor,
  doorIsOpen,
  maskUnverifiedDoor,
  DOOR_FRESH_MS,
} from "@/lib/data/upnp-probe";
import { tenants, customers } from "@/lib/schema";

// UPnP 문 검증(마이그 042).
//
// 왜 이 테스트가 있나: 2026-08-12 에 우리집 공유기가 AddPortMapping 을 받아 주고 되읽어도
//   매핑이 멀쩡한데(enabled=1, 임대 살아 있음) 인터넷에서 오는 연결을 랜 안쪽으로 넘기지
//   않았다. 붙기는 붙고 응답만 없었다. 그 주소를 그대로 본사 앱에 내주면 원격마다 죽은
//   후보를 하나씩 잡는다. 그래서 계약은 딱 하나다 — **바깥에서 인사를 받아 본 문만 열린 것.**

async function seed(slug: string, remoteId: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  await db.insert(customers).values({ tenantId: t.id, name: slug, remoteId });
  const token = await registerHeartbeatToken(remoteId);
  return { tenantId: t.id, token: token! };
}

async function readDoor(remoteId: string) {
  const db = testDb();
  const [row] = await db
    .select({
      endpoint: customers.upnpEndpoint,
      verifiedAt: customers.upnpVerifiedAt,
      probeAt: customers.upnpProbeAt,
    })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return row;
}

const OPEN = async () => true;
const SHUT = async () => false;

describe("문 검증 (마이그 042)", () => {
  it("인사를 받으면 열림으로 기록한다", async () => {
    const { tenantId, token } = await seed("door-a", "GD11110001");
    await setUpnpEnabled("GD11110001", true, tenantId);
    await recordHeartbeat("GD11110001", token, "1.4.111", undefined, undefined, undefined, undefined, {
      upnp: "yes",
      upnpEndpoint: "1.2.3.4:21118",
    });

    expect(await probeUpnpDoor("GD11110001", OPEN)).toBe("open");
    const row = await readDoor("GD11110001");
    expect(row?.verifiedAt).toBeTruthy();
    expect(row?.probeAt).toBeTruthy();
  });

  it("붙기만 하고 인사가 없으면 닫힘이다 — 우리집 공유기 사례", async () => {
    const { tenantId, token } = await seed("door-b", "GD11110002");
    await setUpnpEnabled("GD11110002", true, tenantId);
    await recordHeartbeat("GD11110002", token, "1.4.111", undefined, undefined, undefined, undefined, {
      upnpEndpoint: "1.2.3.4:21118",
    });

    expect(await probeUpnpDoor("GD11110002", SHUT)).toBe("closed");
    const row = await readDoor("GD11110002");
    // 주소 자체는 남긴다(공유기가 뭐라고 했는지는 진단에 필요). 검증만 안 선다.
    expect(row?.endpoint).toBe("1.2.3.4:21118");
    expect(row?.verifiedAt).toBeNull();
    expect(row?.probeAt).toBeTruthy();
  });

  it("한 번 열렸다가 닫히면 검증을 즉시 취소한다", async () => {
    const { tenantId, token } = await seed("door-c", "GD11110003");
    await setUpnpEnabled("GD11110003", true, tenantId);
    await recordHeartbeat("GD11110003", token, "1.4.111", undefined, undefined, undefined, undefined, {
      upnpEndpoint: "1.2.3.4:21118",
    });
    expect(await probeUpnpDoor("GD11110003", OPEN)).toBe("open");

    // 1시간 간격을 지나게 해서 다시 두드릴 수 있게 한다.
    const db = testDb();
    await db
      .update(customers)
      .set({ upnpProbeAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(customers.remoteId, "GD11110003"));

    expect(await probeUpnpDoor("GD11110003", SHUT)).toBe("closed");
    expect((await readDoor("GD11110003"))?.verifiedAt).toBeNull();
  });

  it("같은 거래처를 1시간 안에 두 번 두드리지 않는다", async () => {
    const { tenantId, token } = await seed("door-d", "GD11110004");
    await setUpnpEnabled("GD11110004", true, tenantId);
    await recordHeartbeat("GD11110004", token, "1.4.111", undefined, undefined, undefined, undefined, {
      upnpEndpoint: "1.2.3.4:21118",
    });
    let knocks = 0;
    const count = async () => {
      knocks++;
      return true;
    };
    expect(await probeUpnpDoor("GD11110004", count)).toBe("open");
    expect(await probeUpnpDoor("GD11110004", count)).toBe("skipped");
    expect(knocks).toBe(1);
  });

  it("스위치가 꺼져 있거나 주소가 없으면 두드리지 않는다", async () => {
    const { tenantId, token } = await seed("door-e", "GD11110005");
    // 스위치 off 상태에서 주소만 올라온 경우.
    await recordHeartbeat("GD11110005", token, "1.4.111", undefined, undefined, undefined, undefined, {
      upnpEndpoint: "1.2.3.4:21118",
    });
    let knocks = 0;
    const count = async () => {
      knocks++;
      return true;
    };
    expect(await probeUpnpDoor("GD11110005", count)).toBe("skipped");

    // 켜져 있어도 주소가 없으면 두드릴 대상이 없다.
    const f = await seed("door-f", "GD11110006");
    await setUpnpEnabled("GD11110006", true, f.tenantId);
    expect(await probeUpnpDoor("GD11110006", count)).toBe("skipped");
    expect(knocks).toBe(0);
  });

  it("스위치를 끄면 주소와 검증 기록이 같이 지워진다", async () => {
    const { tenantId, token } = await seed("door-g", "GD11110007");
    await setUpnpEnabled("GD11110007", true, tenantId);
    await recordHeartbeat("GD11110007", token, "1.4.111", undefined, undefined, undefined, undefined, {
      upnpEndpoint: "1.2.3.4:21118",
    });
    await probeUpnpDoor("GD11110007", OPEN);

    await setUpnpEnabled("GD11110007", false, tenantId);
    const row = await readDoor("GD11110007");
    expect(row?.endpoint).toBeNull();
    expect(row?.verifiedAt).toBeNull();
    expect(row?.probeAt).toBeNull();
  });
});

describe("검증 안 된 문은 본사 앱에 안 내려간다", () => {
  it("목록에서 미검증 주소를 지운다", async () => {
    const { tenantId, token } = await seed("door-h", "GD11110008");
    await setUpnpEnabled("GD11110008", true, tenantId);
    await recordHeartbeat("GD11110008", token, "1.4.111", undefined, undefined, undefined, undefined, {
      upnpEndpoint: "1.2.3.4:21118",
    });

    // 아직 검증 전 — 주소가 나가면 안 된다.
    let rows = await listCustomers(tenantId);
    expect(rows[0].upnpEndpoint).toBeNull();

    await probeUpnpDoor("GD11110008", OPEN);
    rows = await listCustomers(tenantId);
    expect(rows[0].upnpEndpoint).toBe("1.2.3.4:21118");
  });

  it("검증이 오래되면 다시 미검증으로 본다", async () => {
    const { tenantId, token } = await seed("door-i", "GD11110009");
    await setUpnpEnabled("GD11110009", true, tenantId);
    await recordHeartbeat("GD11110009", token, "1.4.111", undefined, undefined, undefined, undefined, {
      upnpEndpoint: "1.2.3.4:21118",
    });
    await probeUpnpDoor("GD11110009", OPEN);

    const db = testDb();
    await db
      .update(customers)
      .set({ upnpVerifiedAt: new Date(Date.now() - DOOR_FRESH_MS - 60_000) })
      .where(eq(customers.remoteId, "GD11110009"));

    const rows = await listCustomers(tenantId);
    expect(rows[0].upnpEndpoint).toBeNull();
  });

  it("관제 다이얼로그는 주소는 보여주되 열림 여부는 검증으로 가른다", async () => {
    const { tenantId, token } = await seed("door-j", "GD11110010");
    await setUpnpEnabled("GD11110010", true, tenantId);
    await recordHeartbeat("GD11110010", token, "1.4.111", undefined, undefined, undefined, undefined, {
      upnpEndpoint: "1.2.3.4:21118",
    });
    await probeUpnpDoor("GD11110010", SHUT);

    const st = await getWatchState("GD11110010", tenantId);
    // 진단하려면 공유기가 뭐라고 했는지는 봐야 한다 — 여긴 안 지운다.
    expect(st?.upnpEndpoint).toBe("1.2.3.4:21118");
    expect(doorIsOpen(st!)).toBe(false);
  });

  it("판정 함수는 주소·검증시각이 다 있어야 참", () => {
    expect(doorIsOpen({ upnpEndpoint: null, upnpVerifiedAt: new Date() })).toBe(false);
    expect(doorIsOpen({ upnpEndpoint: "1.2.3.4:1", upnpVerifiedAt: null })).toBe(false);
    expect(doorIsOpen({ upnpEndpoint: "1.2.3.4:1", upnpVerifiedAt: new Date() })).toBe(true);
    expect(
      maskUnverifiedDoor({ upnpEndpoint: "1.2.3.4:1", upnpVerifiedAt: null }).upnpEndpoint,
    ).toBeNull();
  });
});
