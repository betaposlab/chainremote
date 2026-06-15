// POST /api/auth/heartbeat — HQ 앱이 ~10초마다 호출 (Bearer 토큰).
// 응답: 200 { ok: true }                  → 좌석 유지 (last_seen 갱신)
//       401 { error:"REVOKED", revoked:true } → 인계당함/로그아웃됨 → 앱이 자기 세션 끊고 로그아웃
//       200 { ok:true, enforced:false }    → jti 없는 옛 토큰 (백워드 호환, enforcement 대상 아님)
//
// 스펙: docs/chainremote/SEAT_ENFORCEMENT.md §5
// 주의: 만료/위변조 토큰은 requireApiAuth 가 401 "토큰 검증 실패" 로 던짐 (revoked 플래그 없음).
//       앱은 revoked=true 만 "인계당함"으로 처리하고, 그 외 401 은 재로그인 유도.

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import { touchHeartbeat } from "@/lib/data/active-sessions";
import { isTenantActive } from "@/lib/data/tenants";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    // H1: 정지/해지 테넌트 즉시 차단 (super_admin 예외 — 자기잠금 방지). 24h 토큰이 정지 후에도
    //     살아있는 공백 제거 → heartbeat 주기(~10초)로 반영. 비-revoked 401 이라 앱은 재로그인 유도,
    //     재로그인도 H1(403)로 차단되어 일관. (옛 jti 없는 토큰도 이 차단은 적용.)
    if (me.role !== "super_admin" && !(await isTenantActive(me.tenantId))) {
      return Response.json({ error: "구독이 정지되었습니다" }, { status: 401 });
    }
    // HQ 앱 버전 보고 (옵셔널, 방어적 파싱 — 옛 클라는 빈 바디 {}). 패널 직원화면 가시화용.
    //   형식 검증(X.Y.Z…, 24자 이하)된 것만 저장. 바디 못 읽어도 heartbeat 는 정상 진행.
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
    // 옛 토큰(jti 없음) — 전환기 백워드 호환. enforcement 미적용으로 통과.
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
