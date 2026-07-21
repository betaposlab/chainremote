// POST /api/auth/heartbeat — HQ 앱이 ~10초마다 호출 (Bearer). last_seen 갱신 + 좌석 유지.
// 인계당하거나 로그아웃되면 401 revoked:true 로 응답해 앱이 스스로 세션을 끊는다.
// 스펙: docs/chainremote/SEAT_ENFORCEMENT.md §5
//
// 만료/위변조 토큰은 requireApiAuth 가 revoked 없는 401 로 던진다. 앱은 revoked=true 만
// "인계당함"으로 보고, 나머지 401 은 재로그인으로 처리한다.

import { requireApiAuth, jsonError, needsTokenRefresh, signApiToken } from "@/lib/api-auth";
import { touchHeartbeat } from "@/lib/data/active-sessions";
import { isTenantActive } from "@/lib/data/tenants";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";

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
    // 정규식은 끝($)까지 앵커 — "1.4.65abc" 같은 접미 오염을 last_version 에 저장하지 않는다.
    let version: string | null = null;
    try {
      const body = await req.json();
      if (
        body &&
        typeof body.version === "string" &&
        /^\d+\.\d+\.\d+$/.test(body.version) &&
        body.version.length <= 24
      ) {
        version = body.version;
      }
    } catch {
      // 빈/비-JSON 바디 (옛 클라) — version 없이 진행
    }
    // jti 없는 옛 토큰은 전환기 호환용 — enforcement 없이 통과시키되 롤링(재발급)도 하지 않는다.
    // 롤링해주면 옛 jti-less 세션이 영원히 안 만료돼 좌석 enforcement 를 영구 우회한다(좀비
    // 봉인의 우회로). 만료되면 재로그인 → 신 토큰이 jti 를 받아 정상 궤도(좌석/롤링)에 편입된다.
    if (!me.jti) {
      return Response.json({ ok: true, enforced: false });
    }
    // 토큰 롤링 재발급(2026-07-20 좀비 로그인 사고 봉인) — 수명 절반부터 새 토큰을 실어
    // 보낸다. 앱이 살아있는 한 만료가 안 오고, 만료는 "24h+ 꺼뒀다 켠 앱"에서만 발생 →
    // 그건 클라이언트가 expired 로 감지해 재로그인 화면으로 안내한다(무음 좀비 금지).
    // ★role/displayName 은 옛 클레임을 복사하지 않고 DB 현재값을 다시 읽어 반영한다 —
    //   권한 강등/이름 변경/계정 비활성이 재발급 토큰에 즉시 먹도록(강등 영구 미반영 봉인).
    let refreshed: string | undefined;
    if (needsTokenRefresh(me.exp)) {
      const [u] = await db
        .select({
          role: users.role,
          displayName: users.displayName,
          email: users.email,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, me.uid))
        .limit(1);
      // 삭제됐거나 비활성화된 계정 — 재발급하지 않고 세션 종료를 유도한다.
      if (!u || !u.isActive) {
        return Response.json({ error: "REVOKED", revoked: true }, { status: 401 });
      }
      const { token } = await signApiToken(
        {
          uid: me.uid,
          email: u.email,
          displayName: u.displayName,
          role: u.role,
          tenantId: me.tenantId,
        },
        me.jti, // 같은 jti = active_login_sessions 좌석 행 그대로 유효
      );
      refreshed = token;
    }
    const alive = await touchHeartbeat(me.uid, me.jti, version);
    if (!alive) {
      return Response.json({ error: "REVOKED", revoked: true }, { status: 401 });
    }
    return Response.json(refreshed ? { ok: true, token: refreshed } : { ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
