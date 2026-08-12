// POST /api/customers/heartbeat — agent 가 10~15분마다 호출.
// X-ChainRemote-Token 헤더로 인증하고 last_heartbeat_at + last_version 갱신.
// 매칭/업데이트는 lib/data/customers.ts::recordHeartbeat.

import { after } from "next/server";
import * as data from "@/lib/data/customers";
import { probeUpnpDoor } from "@/lib/data/upnp-probe";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    // per-IP 완만한 rate-limit (스캔/DoS 백스톱). 600/분이면 NAT 뒤 대리점 수십 POS 도
    // 안 걸릴 만큼 여유 — 토큰이 어차피 1차 게이트라 여긴 백스톱일 뿐.
    const ip = clientIp(req) ?? "unknown";
    const rl = rateLimit(`cust-hb:${ip}`, 600, 60_000);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

    const token = req.headers.get("X-ChainRemote-Token");
    if (!token) {
      return Response.json({ error: "token 헤더 필수" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      remoteId?: unknown;
      version?: unknown;
      machineUuid?: unknown;
      arch?: unknown;
      os?: unknown;
      osBits?: unknown;
      diskTotal?: unknown;
      diskFree?: unknown;
      tempBytes?: unknown;
      cleanupResult?: unknown;
      firewallEnabled?: unknown;
      firewallDisarmed?: unknown;
      vanOk?: unknown;
      vanRestarted?: unknown;
      vanGaveUp?: unknown;
      vanMissing?: unknown;
      natType?: unknown;
      upnp?: unknown;
      upnpEndpoint?: unknown;
    };
    const remoteId =
      typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    const version =
      typeof body.version === "string" ? body.version.trim() : "";
    // 기기지문 — 옛 거래처 backfill 용(앵커). 빈값이면 무시.
    const machineUuid =
      typeof body.machineUuid === "string" ? body.machineUuid.trim() : "";
    // 프로세스 arch(020) + OS 표시(021) — recordHeartbeat 가 유효값만 반영, 미보고(구버전)면 무시.
    const arch = typeof body.arch === "string" ? body.arch.trim() : "";
    const os = typeof body.os === "string" ? body.os.trim() : "";
    const osBits = typeof body.osBits === "string" ? body.osBits.trim() : "";
    if (!remoteId || !version) {
      return Response.json(
        { error: "remoteId + version 필수" },
        { status: 400 },
      );
    }
    // 디스크 관제(024) — 숫자만 통과, 이상값은 recordHeartbeat 가 한 번 더 거른다.
    const asNum = (v: unknown) => (typeof v === "number" ? v : undefined);
    const cleanupResult =
      typeof body.cleanupResult === "string" ? body.cleanupResult : undefined;
    const ok = await data.recordHeartbeat(
      remoteId,
      token,
      version,
      machineUuid || undefined,
      arch || undefined,
      os || undefined,
      osBits || undefined,
      {
        diskTotal: asNum(body.diskTotal),
        diskFree: asNum(body.diskFree),
        tempBytes: asNum(body.tempBytes),
        cleanupResult,
        firewallEnabled:
          typeof body.firewallEnabled === "boolean" ? body.firewallEnabled : undefined,
        firewallDisarmed: body.firewallDisarmed === true,
        vanOk: typeof body.vanOk === "boolean" ? body.vanOk : undefined,
        vanRestarted: body.vanRestarted === true,
        vanGaveUp: typeof body.vanGaveUp === "boolean" ? body.vanGaveUp : undefined,
        vanMissing: typeof body.vanMissing === "boolean" ? body.vanMissing : undefined,
        // NAT 유형(039) — 릴레이 원인 집계용. 구버전 에이전트는 안 보내므로 NULL 로 남는다.
        natType: typeof body.natType === "number" ? body.natType : undefined,
        // 공유기 UPnP(040) — 직결을 되살릴 길이 있는 거래처를 세기 위한 값.
        upnp: typeof body.upnp === "string" ? body.upnp : undefined,
        // 공유기가 열어 준 바깥 주소(041).
        upnpEndpoint:
          typeof body.upnpEndpoint === "string" ? body.upnpEndpoint : undefined,
      },
    );
    if (!ok) {
      return Response.json(
        { error: "token 또는 remoteId 불일치" },
        { status: 403 },
      );
    }
    // 정리 명령이 큐돼 있으면 응답에 실어보낸다 — 에이전트는 "마지막 실행 시각"과 다를 때만
    // 실행하므로 요청이 처리될 때까지 매 heartbeat 에 같은 값이 내려가도 무해(멱등).
    const cleanup = await data.getCleanupRequest(remoteId);
    // 방화벽 자동 해제 대상이면 에이전트가 로컬 감시를 켠다(매 heartbeat 에 플래그 전달, 멱등).
    const firewallControl = await data.getFirewallControl(remoteId);
    // VAN 데몬 관제(마이그 036) — 종류를 내려보내면 에이전트가 그 데몬의 포트를 감시한다.
    //   거래처마다 VAN 사가 달라 켠 곳에만 값이 실린다(빈 값이면 에이전트가 감시를 끈다).
    const vanWatch = await data.getVanWatch(remoteId);
    // 포트 열기 대상이면 에이전트가 공유기에 매핑을 걸고 직접 접속 리스너를 켠다(041).
    //   기본 false 라 켠 거래처에만 내려간다.
    const upnpEnabled = await data.getUpnpEnabled(remoteId);
    // 열어 둔 문이 바깥에서 진짜 열려 있는지 확인한다(마이그042). after() 로 응답 뒤에 돌려
    //   heartbeat 가 3초짜리 소켓 시험을 기다리지 않게 한다 — 떠도는 프라미스로 두면 런타임이
    //   응답과 함께 잘라 버릴 수 있다. 거래처당 1시간에 한 번만 실제로 두드린다.
    //
    // ★이 줄이 heartbeat 를 깨뜨릴 수 없어야 한다. after() 는 요청 스코프 밖에서 호출되면
    //   던지는데(라우트를 직접 부르는 테스트가 그렇다), 그 예외가 바깥 catch 로 흘러가면
    //   500 이 되고 에이전트는 자동 업데이트까지 통째로 잃는다 — 조용히 고착되는 그 사고다.
    //   그래서 스코프가 없으면 그냥 지금 돌린다(우리 패널은 상주 Node 컨테이너라 안전).
    const knockDoorLater = () => probeUpnpDoor(remoteId).catch(() => {});
    try {
      after(knockDoorLater);
    } catch {
      void knockDoorLater();
    }
    // 거래처 수락창에 띄울 대리점 상호(마이그 029). 에이전트가 캐시해 두고 카드에 쓴다.
    //   여기로 내려보내는 이유는 설치본에 박으면 자동 업데이트가 덮어버리고 상호 변경도
    //   반영이 안 되기 때문(getSupportName 주석 참조).
    const supportName = await data.getSupportName(remoteId);
    return Response.json({
      ok: true,
      ...(cleanup ? { cleanup } : {}),
      firewallControl,
      vanWatch,
      upnpEnabled,
      ...(supportName ? { supportName } : {}),
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
