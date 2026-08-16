// POST /api/customers/enroll — 거래처 agent 자가등록(auto-enroll).
//
// 신규 .exe 설치 후 토큰이 없는 agent 가 호출 → 패널에 'pending' 후보로 등록되고
// heartbeat 토큰을 받아 register 409 루프를 건너뛴다. HQ 가 패널서 확인하면 'active'.
//
// 인증은 per-tenant: tenant-slug + enroll-key (빌드타임에 그 tenant 의 custom.txt 에 박힘).
// enroll-key 평문은 agent 에만, DB 엔 sha-256 해시만. register-heartbeat-token 과 별도
// 엔드포인트로 둔 건 그쪽의 idempotent rotation 계약을 안 건드려 heartbeat-token-stuck 재발을 막으려는 것.
//
// 미인증이 row 를 CREATE 하므로 enroll-key 해시검증 + rate-limit + pending 격리로 막고,
// remote_id 글로벌 unique(마이그 011)가 cross-tenant 를 끊는다.

import * as data from "@/lib/data/customers";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    // row 를 CREATE 하니 heartbeat 계열보다 빡세게 5/min. DoS 백스톱.
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
      newSite?: unknown;
    };
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const remoteId = str(body.remoteId);
    const tenantSlug = str(body.tenantSlug);
    const enrollKey = str(body.enrollKey);
    const name = str(body.name) || undefined;
    const hostname = str(body.hostname) || undefined;
    // 기기지문 앵커 — 빈값/미전송이면 undefined(매칭 제외).
    const machineUuid = str(body.machineUuid) || undefined;
    // 설치 화면에서 "다른 매장에 설치합니다"를 고른 경우(2026-08-16). 옛 인스톨러는 이 값을
    //   안 보내므로 undefined = 지금까지와 똑같이 동작한다(하위호환).
    const newSite = body.newSite === true || body.newSite === "true";

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

    const result = await data.enrollCustomer(
      { remoteId, name, hostname, machineUuid, newSite },
      { tenantId },
    );
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
