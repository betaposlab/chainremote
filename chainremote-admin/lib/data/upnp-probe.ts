// UPnP 로 연 문을 **바깥에서 두드려 확인한다**(마이그042).
//
// 배경(2026-08-12 우리집 실측): 공유기에 AddPortMapping 이 성공하고, 되읽어도 매핑이
//   멀쩡히 살아 있는데도 인터넷에서 그 포트로 오는 연결이 랜 안쪽까지 도달하지 않았다.
//   공유기가 WAN 쪽에서 자기가 TCP 를 받아 버리고 넘기지 않은 것이다 — PC 소켓 목록에
//   그 연결이 아예 없었고, 같은 공유기의 다른 매핑(NAS 로 가는 것 포함)도 전부 같았다.
//
// 그래서 "공유기가 열었다고 했다"를 증거로 쓰지 않는다. 판정 기준은 딱 하나다:
//   **그 주소로 붙어서 에이전트의 인사(SignedId)를 실제로 받았는가.**
//   붙기만 하는 문은 위 사고에서 그대로 나온 증상이라 열린 것으로 세면 안 된다.
//
// 어디서 도는가: 패널 서버(클라우드)다. 거래처 네트워크 밖의 진짜 인터넷 시점이라야
//   의미가 있고, 에이전트 자신은 헤어핀 NAT 때문에 자기 문을 못 두드린다.
//
// 언제 도는가: heartbeat 처리 끝에 fire-and-forget 으로 부른다. 크론도 인스트루멘테이션도
//   필요 없고, 살아 있는 거래처만 자연히 검사된다(꺼진 기기는 두드려 봐야 의미 없다).
//   거래처당 1시간에 한 번으로 묶어 heartbeat 마다 두드리지 않는다.

import net from "node:net";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/schema";

/** 같은 거래처를 이 간격 안에 두 번 두드리지 않는다. */
export const PROBE_EVERY_MS = 60 * 60 * 1000;
/** 검증이 이보다 오래되면 다시 미검증으로 본다 — 공유기 재부팅·임대 만료로 문은 조용히 닫힌다. */
export const DOOR_FRESH_MS = 6 * 60 * 60 * 1000;

const CONNECT_TIMEOUT_MS = 3000;
const GREET_TIMEOUT_MS = 2000;

/** 문 하나를 두드린다. 붙기만 해서는 실패고, 첫 바이트까지 와야 성공이다. */
export function knockDoor(endpoint: string): Promise<boolean> {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(endpoint.trim());
  if (!m) return Promise.resolve(false);
  const [, host, portText] = m;
  const port = Number(portText);
  if (port < 1 || port > 65535) return Promise.resolve(false);

  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    let greetTimer: NodeJS.Timeout | undefined;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (greetTimer) clearTimeout(greetTimer);
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(CONNECT_TIMEOUT_MS, () => done(false));
    sock.once("error", () => done(false));
    // 붙기만 한 상태로 끝나면 실패다. 인사를 기다리는 시계를 여기서 건다.
    sock.once("connect", () => {
      sock.setTimeout(0);
      greetTimer = setTimeout(() => done(false), GREET_TIMEOUT_MS);
    });
    // 첫 바이트 = 에이전트가 보낸 SignedId. 받자마자 끊는다 — 키 교환으로 넘어가지 않으므로
    //   거래처 화면에 수락 카드가 뜨지 않는다(로그인 요청을 보내야 카드가 뜬다).
    sock.once("data", (buf) => done(buf.length > 0));
    sock.once("close", () => done(false));
    sock.connect(port, host);
  });
}

/** 검증이 살아 있는 문인가 — 이 값이 참일 때만 본사 앱에 주소를 내준다. */
export function doorIsOpen(row: {
  upnpEndpoint?: string | null;
  upnpVerifiedAt?: Date | string | null;
}): boolean {
  if (!row.upnpEndpoint) return false;
  const at = row.upnpVerifiedAt;
  if (!at) return false;
  const ms = at instanceof Date ? at.getTime() : Date.parse(String(at));
  return Number.isFinite(ms) && Date.now() - ms < DOOR_FRESH_MS;
}

/** 검증 안 된 문의 주소는 지우고 내보낸다. 본사 앱이 죽은 주소를 후보로 잡지 않게. */
export function maskUnverifiedDoor<
  T extends { upnpEndpoint?: string | null; upnpVerifiedAt?: Date | string | null },
>(row: T): T {
  return doorIsOpen(row) ? row : { ...row, upnpEndpoint: null };
}

/**
 * heartbeat 뒤에 붙는 검사. 스위치가 켜져 있고 주소가 올라온 거래처만, 1시간에 한 번.
 * 실패해도 조용히 넘어간다 — heartbeat 는 이것과 무관하게 성공해야 한다.
 *
 * knock 을 주입받는 이유는 테스트에서 실제 소켓을 열지 않기 위해서다.
 */
export async function probeUpnpDoor(
  remoteId: string,
  knock: (endpoint: string) => Promise<boolean> = knockDoor,
): Promise<"skipped" | "open" | "closed"> {
  const cutoff = new Date(Date.now() - PROBE_EVERY_MS);
  const [row] = await db
    .select({ endpoint: customers.upnpEndpoint, probeAt: customers.upnpProbeAt })
    .from(customers)
    .where(
      and(
        eq(customers.remoteId, remoteId),
        eq(customers.upnpEnabled, true),
        isNotNull(customers.upnpEndpoint),
      ),
    )
    .limit(1);
  if (!row?.endpoint) return "skipped";
  if (row.probeAt && row.probeAt > cutoff) return "skipped";

  // 시도 시각을 먼저 찍는다 — 두드리는 3초 사이에 들어온 heartbeat 가 같은 문을 또
  //   두드리지 않게. 실패해도 이 값은 남아 "확인해 봤지만 닫혀 있다"가 구분된다.
  await db
    .update(customers)
    .set({ upnpProbeAt: new Date() })
    .where(eq(customers.remoteId, remoteId));

  const open = await knock(row.endpoint);
  if (open) {
    await db
      .update(customers)
      .set({ upnpVerifiedAt: new Date() })
      .where(eq(customers.remoteId, remoteId));
  } else {
    // 닫힌 문은 검증을 즉시 취소한다. 6시간 만료를 기다리면 그동안 본사 앱이 죽은 주소로
    //   계속 후보를 잡는다.
    await db
      .update(customers)
      .set({ upnpVerifiedAt: null })
      .where(and(eq(customers.remoteId, remoteId), sql`${customers.upnpVerifiedAt} is not null`));
  }
  return open ? "open" : "closed";
}
