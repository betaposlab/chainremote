// POST /api/customers/enroll-check — 설치 화면이 상호를 넣는 순간 "같은 상호가 이미 있는가"를 묻는다.
//
// 2026-09-30. 서버가 상호만 보고 기기 교체로 합치던 것을 없애면서, 판단을 설치하는 사람에게
//   돌려준다: 같은 상호가 있으면 인스톨러가 "그 매장 포스 교체인가, 다른 매장인가"를 묻고
//   답을 enroll 에 실어 보낸다(replaceExisting / newSite). 사람은 기억을 못 해도 화면이 알려 준다.
//
// 인증은 enroll 과 같다(대리점 slug + enroll-key). 응답에는 그 대리점의 같은 상호 거래처만,
//   그것도 ID·마지막 접속·생존 여부만 싣는다.

import * as data from "@/lib/data/customers";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ip = clientIp(req) ?? "unknown";
    const rl = rateLimit(`enroll-check:${ip}`, 20, 60_000);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

    const body = (await req.json().catch(() => ({}))) as {
      tenantSlug?: unknown;
      enrollKey?: unknown;
      name?: unknown;
    };
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const tenantSlug = str(body.tenantSlug);
    const enrollKey = str(body.enrollKey);
    const name = str(body.name);
    if (!tenantSlug || !enrollKey) {
      return Response.json({ error: "tenant 인증 정보 필수" }, { status: 400 });
    }
    if (!name) return Response.json({ matches: [] });

    const tenantId = await data.resolveTenantByEnroll(tenantSlug, enrollKey);
    if (!tenantId) {
      return Response.json({ error: "tenant 인증 실패" }, { status: 403 });
    }
    const matches = await data.findCustomersByNameKey(name, tenantId);
    return Response.json({ matches });
  } catch (e) {
    // 예외 문구는 바디에 싣지 않는다(CWE-209 — enroll 라우트와 같은 이유).
    console.error("[agent-api] enroll-check unhandled:", e instanceof Error ? e.message : e);
    return Response.json({ error: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
