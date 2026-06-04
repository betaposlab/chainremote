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

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    // 옛 토큰(jti 없음) — 전환기 백워드 호환. enforcement 미적용으로 통과.
    if (!me.jti) {
      return Response.json({ ok: true, enforced: false });
    }
    const alive = await touchHeartbeat(me.uid, me.jti);
    if (!alive) {
      return Response.json({ error: "REVOKED", revoked: true }, { status: 401 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
