// 임시 원격 — 고객 PC 의 RustDesk(상류 공식 exe)가 스스로 보내는 신고를 받는 자리.
//
// 파일 이름에 실린 api 주소가 `https://626.kr/api/qs/<토큰>` 이라, 상류 클라이언트는
//   POST …/api/sysinfo    켜진 직후 한 번  {id, uuid, hostname, os, username, cpu, memory, version}
//   POST …/api/heartbeat  15초마다          {id, uuid, ver, conns?, modified_at}
// 를 보낸다(src/hbbs_http/sync.rs). 우리는 그중 ID·PC 이름·OS 만 적는다.
//
// ★응답 형식은 상류 클라이언트가 정한다. 바꾸면 그쪽 동작이 달라진다.
//   sysinfo   — 본문이 정확히 "SYSINFO_UPDATED" 여야 "올렸다"로 치고 그만 보낸다.
//               다른 값이면 2분마다 다시 올린다. "ID_NOT_FOUND" 면 3초마다 — 주지 말 것.
//   heartbeat — JSON. `disconnect`·`strategy`·`sysinfo` 키가 있으면 **명령으로 실행**한다.
//               빈 객체만 돌려준다. 여기에 키를 더하는 건 고객 PC 를 조종하는 일이다.
// ★모르는 토큰·만료된 토큰에도 같은 응답을 준다. 토큰이 살아 있는지 알려 줄 이유가 없고,
//   다르게 답하면 고객 PC 의 RustDesk 가 재시도를 반복한다.
// ★계정명(username)·uuid·CPU·메모리는 받아도 저장하지 않는다.

import { recordQuickSupportReport } from "@/lib/data/quick-support";
import { QUICK_SUPPORT_TOKEN_RE } from "@/lib/quick-support";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string; kind: string }> };

function reply(kind: string): Response {
  if (kind === "sysinfo") {
    return new Response("SYSINFO_UPDATED", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return Response.json({}, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, ctx: Ctx) {
  const { token, kind } = await ctx.params;
  if (kind !== "sysinfo" && kind !== "heartbeat") {
    return new Response("Not Found", { status: 404 });
  }
  if (!QUICK_SUPPORT_TOKEN_RE.test(token)) return reply(kind);
  // 정상은 분당 4회(heartbeat) + 가끔 sysinfo. 넉넉히 두되 폭주는 적지 않는다.
  if (!rateLimit(`qs-report:${token}`, 20, 60_000).allowed) return reply(kind);

  try {
    const text = await req.text();
    if (text.length > 16_384) return reply(kind);
    const body = JSON.parse(text) as Record<string, unknown>;
    const conns = Array.isArray(body.conns) ? body.conns.length : 0;
    await recordQuickSupportReport(token, {
      remoteId: body.id,
      hostname: kind === "sysinfo" ? body.hostname : undefined,
      os: kind === "sysinfo" ? body.os : undefined,
      // 붙어 있는지는 heartbeat 만 안다. sysinfo 는 건드리지 않는다.
      connected: kind === "heartbeat" ? conns > 0 : undefined,
    });
  } catch (e) {
    // 고객 PC 로는 언제나 같은 응답. 원인은 서버 로그에만.
    console.error("[qs-report]", kind, e instanceof Error ? e.message : e);
  }
  return reply(kind);
}
