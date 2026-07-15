// POST /api/customers/heartbeat — agent 가 10~15분마다 호출.
// X-ChainRemote-Token 헤더로 인증하고 last_heartbeat_at + last_version 갱신.
// 매칭/업데이트는 lib/data/customers.ts::recordHeartbeat.

import * as data from "@/lib/data/customers";
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
    return Response.json(cleanup ? { ok: true, cleanup } : { ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
