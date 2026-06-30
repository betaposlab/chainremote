// POST /api/customers/heartbeat
//
// Agent 가 주기적으로 (10~15분) 호출. 토큰 검증 + last_heartbeat_at + last_version update.
//
// 인증: X-ChainRemote-Token 헤더. lib/data/customers.ts::recordHeartbeat 가 매칭 + update.
//
// 호출 예 (Rust agent):
//   POST https://sepani.synology.me:3001/api/customers/heartbeat
//   X-ChainRemote-Token: <64 hex>
//   Content-Type: application/json
//   { "remoteId": "129264698", "version": "1.3.2" }
//
//   200 → { "ok": true }
//   401 → { "error": "token 헤더 필수" }
//   403 → { "error": "token 또는 remoteId 불일치" }

import * as data from "@/lib/data/customers";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    // H3: per-IP 완만한 rate-limit (스캔/DoS 백스톱). 600/분 — 실거래처 부하의 10배+ 여유라
    //     한 NAT 뒤 다중 agent(대리점 수십 POS)도 throttle 안 됨. 토큰 자체가 1차 게이트.
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
    };
    const remoteId =
      typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    const version =
      typeof body.version === "string" ? body.version.trim() : "";
    // 기기지문 — 옛 거래처 backfill 용(앵커). 빈값이면 무시.
    const machineUuid =
      typeof body.machineUuid === "string" ? body.machineUuid.trim() : "";
    if (!remoteId || !version) {
      return Response.json(
        { error: "remoteId + version 필수" },
        { status: 400 },
      );
    }
    const ok = await data.recordHeartbeat(remoteId, token, version, machineUuid || undefined);
    if (!ok) {
      return Response.json(
        { error: "token 또는 remoteId 불일치" },
        { status: 403 },
      );
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
