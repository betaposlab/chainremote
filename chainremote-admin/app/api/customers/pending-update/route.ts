// GET  /api/customers/pending-update — agent 가 5분마다 폴링 (대기 푸시 1건 조회)
// POST /api/customers/pending-update — agent 의 설치 완료/실패 보고
//
// 둘 다 X-ChainRemote-Token 헤더 + remoteId 로 인증 (heartbeat 와 동일 패턴).
// GET 은 대기 없음/토큰 불일치를 구분 안 하고 둘 다 { id: null } — 아래 참조.

import * as data from "@/lib/data/pending-updates";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export async function GET(req: Request) {
  try {
    // per-IP 완만한 rate-limit (GET/POST 공유 버킷). 600/분 — NAT 뒤 다중 agent 안 걸림.
    const ip = clientIp(req) ?? "unknown";
    const rl = rateLimit(`cust-pu:${ip}`, 600, 60_000);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

    const token = req.headers.get("X-ChainRemote-Token");
    if (!token) {
      return Response.json({ error: "token 헤더 필수" }, { status: 401 });
    }
    const url = new URL(req.url);
    const remoteId = (url.searchParams.get("remoteId") ?? "").trim();
    if (!remoteId) {
      return Response.json({ error: "remoteId 필수" }, { status: 400 });
    }
    const row = await data.getPendingForAgent(remoteId, token);
    if (!row) {
      // "대기 없음"과 "토큰 불일치"를 둘 다 200 { id: null } 로 통일 — agent 도 단순해지고
      // 응답이 같아 토큰 존재 여부를 떠보는 사이드채널도 안 생긴다.
      return Response.json({ id: null });
    }
    return Response.json(row);
  } catch (e) {
    // ★본문에 예외 문구를 싣지 않는다. drizzle 은 DB 에러에 **쿼리 전문과 바인딩
    //   파라미터**를 담아 두므로 String(e) 를 그대로 실으면 그게 응답으로 샌다(CWE-209).
    //   이 라우트들은 세션이 아니라 에이전트 키·토큰으로 들어오는데, enroll-key 는 모든
    //   설치본에 평문으로 들어 있어 거래처 PC 한 대면 닿는다 — 무인증이나 마찬가지다.
    //   2026-08-16 감사가 jsonError 로 이 기본을 뒤집었는데 이 네 곳이 빠져 있었다.
    //   ★상태 코드는 500 그대로 둔다. 에이전트가 5xx 를 "일시적 실패 → 재시도"로 읽으므로
    //   jsonError 처럼 400/409 로 바꾸면 재시도 판정이 달라진다. 원인은 서버 로그에만.
    console.error("[agent-api] unhandled:", e instanceof Error ? e.message : e);
    return Response.json({ error: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // per-IP 완만한 rate-limit (GET 과 동일 버킷 공유).
    const ip = clientIp(req) ?? "unknown";
    const rl = rateLimit(`cust-pu:${ip}`, 600, 60_000);
    if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

    const token = req.headers.get("X-ChainRemote-Token");
    if (!token) {
      return Response.json({ error: "token 헤더 필수" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      id?: unknown;
      remoteId?: unknown;
      status?: unknown;
      reason?: unknown;
    };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const remoteId = typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    const status = typeof body.status === "string" ? body.status.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!id || !remoteId || (status !== "applied" && status !== "failed")) {
      return Response.json({ error: "id + remoteId + status(applied|failed) 필수" }, { status: 400 });
    }
    const ok =
      status === "applied"
        ? await data.markApplied(id, remoteId, token)
        : await data.markFailed(id, remoteId, token, reason || "unknown");
    if (!ok) {
      return Response.json({ error: "매칭 실패 또는 이미 처리됨" }, { status: 403 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    // ★본문에 예외 문구를 싣지 않는다. drizzle 은 DB 에러에 **쿼리 전문과 바인딩
    //   파라미터**를 담아 두므로 String(e) 를 그대로 실으면 그게 응답으로 샌다(CWE-209).
    //   이 라우트들은 세션이 아니라 에이전트 키·토큰으로 들어오는데, enroll-key 는 모든
    //   설치본에 평문으로 들어 있어 거래처 PC 한 대면 닿는다 — 무인증이나 마찬가지다.
    //   2026-08-16 감사가 jsonError 로 이 기본을 뒤집었는데 이 네 곳이 빠져 있었다.
    //   ★상태 코드는 500 그대로 둔다. 에이전트가 5xx 를 "일시적 실패 → 재시도"로 읽으므로
    //   jsonError 처럼 400/409 로 바꾸면 재시도 판정이 달라진다. 원인은 서버 로그에만.
    console.error("[agent-api] unhandled:", e instanceof Error ? e.message : e);
    return Response.json({ error: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
