// POST /api/customers/register-heartbeat-token  { remoteId, tenantSlug, enrollKey } → { token }
//
// 에이전트가 heartbeat 401·403 회복 때 호출해 상태 보고용 토큰을 받는다.
//   200 { token }                  tenant 인증 통과 + 그 tenant 거래처 존재 → 토큰 발급/회전
//   401 { error: "tenant 인증 정보 필수" }  slug/enroll-key 미전송
//   403 { error: "tenant 인증 실패" }      slug/enroll-key 불일치
//   409 { error: "거래처 미등록" }          해당 tenant 에 아직 등록 안 됨
//
// ★H2 봉인(2026-07-07): 옛날엔 무인증(remote_id 만)이라 remote_id 만 알면 남의 거래처 토큰을
//   받아 상태 위조 + 재발급으로 정당 에이전트 축출(DoS)이 가능했다. 이제 enroll(자동등록)과 동일하게
//   tenant-slug + enroll-key 인증을 요구하고 그 tenant 로 스코프해 발급한다. 키 있는 에이전트는
//   원래 enroll 경로를 쓰므로 무영향.
//   [잔존 트레이드오프] 키 없는 옛 에이전트가 "토큰을 분실/무효화당한 뒤"에만 이 경로가 필요한데,
//   이제 401 이라 자가회복 불가 → 패널 상태보고 + 자동업데이트 폴링이 함께 끊긴다(pending-update 도
//   같은 heartbeat 토큰으로 인증). 원격 접속은 무관. 복구 = 패널에서 재다운로드(키 포함) 후 재설치.
//   실 노출: 라이브 거래처 23곳 전부 유효 토큰 보유(2026-07-08 확인)라 현재 영향 0. 토큰을 잃은
//   키리스 에이전트가 생길 때만 발동하는 이론적 회귀. 근본책 = 잔존 키리스 플릿을 키 포함본으로 통일.

import * as data from "@/lib/data/customers";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function POST(req: Request) {
  try {
    const ip = clientIp(req) ?? "unknown";
    const rl = rateLimit(`hbtoken:${ip}`, 20, 60_000);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

    const body = (await req.json().catch(() => ({}))) as {
      remoteId?: unknown;
      tenantSlug?: unknown;
      enrollKey?: unknown;
    };
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const remoteId = str(body.remoteId);
    const tenantSlug = str(body.tenantSlug);
    const enrollKey = str(body.enrollKey);
    if (!remoteId) {
      return Response.json({ error: "remoteId 필수" }, { status: 400 });
    }
    // ★H2: tenant enroll-key 인증 필수 (enroll 라우트와 동일). 무인증 발급 봉인.
    if (!tenantSlug || !enrollKey) {
      return Response.json({ error: "tenant 인증 정보 필수" }, { status: 401 });
    }
    const tenantId = await data.resolveTenantByEnroll(tenantSlug, enrollKey);
    if (!tenantId) {
      return Response.json({ error: "tenant 인증 실패" }, { status: 403 });
    }
    const token = await data.registerHeartbeatToken(remoteId, tenantId);
    if (!token) {
      return Response.json({ error: "거래처 미등록" }, { status: 409 });
    }
    return Response.json({ token });
  } catch (e) {
    // 무인증 호출자에게 내부 예외 문구(String(e))를 그대로 흘리지 않는다 — 서버 로그로만.
    console.error("register-heartbeat-token 500:", e);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
