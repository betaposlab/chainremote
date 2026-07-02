// POST /api/auth/heartbeat — HQ 앱이 ~10초마다 호출 (Bearer). last_seen 갱신 + 좌석 유지.
// 인계당하거나 로그아웃되면 401 revoked:true 로 응답해 앱이 스스로 세션을 끊는다.
// 스펙: docs/chainremote/SEAT_ENFORCEMENT.md §5
//
// 만료/위변조 토큰은 requireApiAuth 가 revoked 없는 401 로 던진다. 앱은 revoked=true 만
// "인계당함"으로 보고, 나머지 401 은 재로그인으로 처리한다.

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import { touchHeartbeat } from "@/lib/data/active-sessions";
import { isTenantActive } from "@/lib/data/tenants";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    // 정지/해지 테넌트 차단. 24h 토큰이 정지 후에도 살아있는 공백을 heartbeat 주기로 메운다.
    // super_admin 은 자기잠금 방지로 예외. 여기서 나가는 401 은 revoked 아니므로 앱이
    // 재로그인을 시도하지만, 그것도 token 라우트가 403 으로 막아 일관되게 차단된다.
    if (me.role !== "super_admin" && !(await isTenantActive(me.tenantId))) {
      return Response.json({ error: "구독이 정지되었습니다" }, { status: 401 });
    }
    // HQ 앱 버전 보고 (옵셔널, 패널 직원화면 표시용). 옛 클라는 빈 바디를 보내므로
    // 형식 맞는 것만 저장하고, 파싱 실패해도 heartbeat 자체는 계속 진행.
    let version: string | null = null;
    try {
      const body = await req.json();
      if (
        body &&
        typeof body.version === "string" &&
        /^\d+\.\d+\.\d+/.test(body.version) &&
        body.version.length <= 24
      ) {
        version = body.version;
      }
    } catch {
      // 빈/비-JSON 바디 (옛 클라) — version 없이 진행
    }
    // jti 없는 옛 토큰은 전환기 호환용 — enforcement 없이 통과시킨다.
    if (!me.jti) {
      return Response.json({ ok: true, enforced: false });
    }
    const alive = await touchHeartbeat(me.uid, me.jti, version);
    if (!alive) {
      return Response.json({ error: "REVOKED", revoked: true }, { status: 401 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
