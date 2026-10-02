// 접속 요청 대리 전달(마이그 056).
//   POST — HQ(Bearer): "hbbs 가 본 내 포트는 이것, 이 거래처에 알려 달라". IP 는 패널이 본 값.
//   GET  — 에이전트(heartbeat 토큰): 자기 앞으로 온 요청을 하나 가져간다.
// 배경은 lib/data/rz-relay.ts.

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import { createRzRelayRequest, takeRzRelayRequest } from "@/lib/data/rz-relay";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const rl = rateLimit(`rz-relay-post:${me.uid}`, 30, 60_000);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);
    const body = (await req.json().catch(() => ({}))) as {
      remoteId?: unknown;
      hqPort?: unknown;
      relayServer?: unknown;
    };
    const remoteId = typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    const hqPort = typeof body.hqPort === "number" ? body.hqPort : NaN;
    const relayServer = typeof body.relayServer === "string" ? body.relayServer : null;
    const ip = clientIp(req);
    if (!remoteId || !ip) return Response.json({ ok: false, reason: "bad_input" }, { status: 400 });
    const r = await createRzRelayRequest({
      tenantId: me.tenantId,
      userId: me.uid,
      remoteId,
      hqIp: ip,
      hqPort,
      relayServer,
    });
    if (!r.ok) {
      // 409 = 그 거래처가 "응답 없음" 상태가 아님 — HQ 는 기다리지 않고 원래 오류를 낸다.
      const status = r.reason === "not_found" ? 404 : r.reason === "not_noreply" ? 409 : 400;
      return Response.json(r, { status });
    }
    return Response.json(r);
  } catch (e) {
    return jsonError(e);
  }
}

export async function GET(req: Request) {
  try {
    const ip = clientIp(req) ?? "unknown";
    // 정상은 "응답 없음" 동안 2초에 한 번. 그 상태인 PC 는 소수라 넉넉히.
    const rl = rateLimit(`rz-relay-get:${ip}`, 120, 60_000);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);
    const token = req.headers.get("X-ChainRemote-Token");
    if (!token) return Response.json({ error: "token 헤더 필수" }, { status: 401 });
    const remoteId = (new URL(req.url).searchParams.get("remoteId") ?? "").trim();
    if (!remoteId) return Response.json({ error: "remoteId 필수" }, { status: 400 });
    const r = await takeRzRelayRequest(remoteId, token);
    return Response.json(r ?? { ip: null });
  } catch (e) {
    console.error("[rz-relay] GET:", e instanceof Error ? e.message : e);
    return Response.json({ error: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
