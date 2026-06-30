// POST /api/customers/enroll
//
// 거래처 agent 자가등록(⑤ auto-enroll). 신규 .exe 설치 시 agent 가 (토큰 없을 때) 호출 →
// 패널에 'pending' 후보로 자동 등록 + heartbeat 토큰 발급(register 409 루프 스킵). HQ 가 패널서 확인하면 'active'.
//
// 인증: per-tenant — tenant-slug + enroll-key (그 tenant 의 agent 빌드 custom.txt 에 빌드타임 박힘).
//   enroll-key 평문은 agent 에만, DB 엔 sha-256 해시만(H3 모델). register-heartbeat-token 과 *별도* 엔드포인트
//   — 그 엔드포인트의 idempotent rotation 계약을 안 건드려 heartbeat-token-stuck 재발 방지.
//
// 보안: 미인증이 row 를 CREATE 할 수 있게 되므로 (1) enroll-key 해시검증 (2) rate-limit 5/min
//   (3) pending 상태(live 목록/일괄푸시 미오염) 3중 게이트. remote_id 글로벌 unique(011)가 cross-tenant 차단.
//
// 호출 예 (Rust agent, 첫 실행 토큰 없을 때):
//   POST https://sepani.synology.me:3001/api/customers/enroll
//   { "remoteId":"129264698", "tenantSlug":"betaposlab", "enrollKey":"<hex>", "name":"봉스푸드", "hostname":"POS-01" }
//   200 → { "token":"<64 hex>" }        ← 신규 pending 생성 또는 기존(같은 tenant) 토큰 회전
//   403 → { "error":"tenant 인증 실패" }  ← slug/enroll-key 불일치
//   409 → { "error":"..." }              ← remote_id 가 타 tenant 소유

import * as data from "@/lib/data/customers";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    // enroll 은 row 를 CREATE 하므로 register(20)보다 빡세게(5/min). DoS 백스톱.
    const ip = clientIp(req) ?? "unknown";
    const rl = rateLimit(`enroll:${ip}`, 5, 60_000);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

    const body = (await req.json().catch(() => ({}))) as {
      remoteId?: unknown;
      tenantSlug?: unknown;
      enrollKey?: unknown;
      name?: unknown;
      hostname?: unknown;
      machineUuid?: unknown;
    };
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const remoteId = str(body.remoteId);
    const tenantSlug = str(body.tenantSlug);
    const enrollKey = str(body.enrollKey);
    const name = str(body.name) || undefined;
    const hostname = str(body.hostname) || undefined;
    // 기기지문 앵커 — 빈값/미전송이면 undefined(매칭 제외).
    const machineUuid = str(body.machineUuid) || undefined;

    if (!remoteId) {
      return Response.json({ error: "remoteId 필수" }, { status: 400 });
    }
    if (!tenantSlug || !enrollKey) {
      return Response.json({ error: "tenant 인증 정보 필수" }, { status: 400 });
    }

    const tenantId = await data.resolveTenantByEnroll(tenantSlug, enrollKey);
    if (!tenantId) {
      return Response.json({ error: "tenant 인증 실패" }, { status: 403 });
    }

    const result = await data.enrollCustomer({ remoteId, name, hostname, machineUuid }, { tenantId });
    if (result === "cross_tenant") {
      return Response.json(
        { error: "다른 tenant 에 이미 등록된 remote_id" },
        { status: 409 },
      );
    }
    return Response.json({ token: result.token });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
