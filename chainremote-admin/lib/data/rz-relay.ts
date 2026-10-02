// 접속 요청 대리 전달 — "응답 없음" PC 에 hbbs 의 PunchHole 대신 패널이 알린다.
// 왜·어떻게는 migrations/056_rz_relay_requests.sql 머리말.

import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, rzRelayRequests } from "@/lib/schema";
import { hashHeartbeatToken } from "@/lib/heartbeat-token";

/** 에이전트가 이 안에 가져가야 한다. HQ 는 그보다 짧게 기다린다(접속 창 20초). */
const PICKUP_WINDOW_MS = 60_000;
/** 이보다 오래된 행은 다음 요청 때 지운다. */
const PURGE_AFTER_MS = 3600_000;
/** 본사 앱·패널의 "응답 없음" 판정과 같은 문턱(app/customers/_status.tsx RZ_NOREPLY_FRESH_MIN). */
const NOREPLY_FRESH_MS = 15 * 60_000;

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const RELAY_RE = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/;

export type RzRelayCreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: "bad_input" | "not_found" | "not_noreply" };

/**
 * HQ 의 대리 전달 요청을 남긴다.
 *
 * ★"응답 없음" 상태인 거래처에만 받는다. 평범한 실패(꺼짐·없는 ID)에까지 받으면 HQ 가
 *   매번 20초를 헛기다리고, 그 상태가 아닌 에이전트는 어차피 이 표를 보지 않는다.
 * ★hqIp 는 클라이언트가 보낸 값이 아니라 **패널이 본 요청자 IP** 다(라우트가 넣는다).
 *   남의 주소로 연결을 유도하는 길을 막는다.
 */
export async function createRzRelayRequest(input: {
  tenantId: string;
  userId: string | null;
  remoteId: string;
  hqIp: string;
  hqPort: number;
  relayServer: string | null;
}): Promise<RzRelayCreateResult> {
  const ip = input.hqIp.replace(/^::ffff:/, "");
  if (!IPV4_RE.test(ip)) return { ok: false, reason: "bad_input" };
  if (!Number.isInteger(input.hqPort) || input.hqPort < 1 || input.hqPort > 65535) {
    return { ok: false, reason: "bad_input" };
  }
  const relay = input.relayServer?.trim() || null;
  if (relay && !RELAY_RE.test(relay)) return { ok: false, reason: "bad_input" };

  const [c] = await db
    .select({
      id: customers.id,
      rzNoreplySince: customers.rzNoreplySince,
      lastHeartbeatAt: customers.lastHeartbeatAt,
    })
    .from(customers)
    .where(and(eq(customers.tenantId, input.tenantId), eq(customers.remoteId, input.remoteId)))
    .limit(1);
  if (!c) return { ok: false, reason: "not_found" };
  const fresh =
    !!c.rzNoreplySince &&
    !!c.lastHeartbeatAt &&
    Date.now() - new Date(c.lastHeartbeatAt).getTime() < NOREPLY_FRESH_MS;
  if (!fresh) return { ok: false, reason: "not_noreply" };

  await db
    .delete(rzRelayRequests)
    .where(lt(rzRelayRequests.createdAt, new Date(Date.now() - PURGE_AFTER_MS)))
    .catch(() => undefined);

  const [row] = await db
    .insert(rzRelayRequests)
    .values({
      tenantId: input.tenantId,
      customerId: c.id,
      hqIp: ip,
      hqPort: input.hqPort,
      relayServer: relay,
      requestedBy: input.userId,
    })
    .returning({ id: rzRelayRequests.id });
  return { ok: true, id: row.id };
}

export type RzRelayPickup = { ip: string; port: number; relayServer: string | null };

/**
 * 에이전트가 자기 앞으로 온 요청을 하나 가져간다(한 번만). 없으면 null.
 * 인증은 heartbeat 토큰 — pending-update 와 같은 방식(저장은 해시라 대조도 해시).
 */
export async function takeRzRelayRequest(
  remoteId: string,
  token: string,
): Promise<RzRelayPickup | null> {
  const since = new Date(Date.now() - PICKUP_WINDOW_MS);
  const rows = await db.execute(sql`
    UPDATE ${rzRelayRequests} r SET consumed_at = now()
    WHERE r.id = (
      SELECT r2.id FROM ${rzRelayRequests} r2
      JOIN ${customers} c ON c.id = r2.customer_id
      WHERE c.remote_id = ${remoteId}
        AND c.heartbeat_token = ${hashHeartbeatToken(token)}
        AND r2.consumed_at IS NULL
        AND r2.created_at > ${since}
      ORDER BY r2.created_at
      LIMIT 1
      FOR UPDATE OF r2 SKIP LOCKED
    )
    RETURNING r.hq_ip, r.hq_port, r.relay_server`);
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  const r = (Array.isArray(list) ? list[0] : undefined) as
    | { hq_ip: string; hq_port: number; relay_server: string | null }
    | undefined;
  if (!r) return null;
  return { ip: r.hq_ip, port: Number(r.hq_port), relayServer: r.relay_server };
}
