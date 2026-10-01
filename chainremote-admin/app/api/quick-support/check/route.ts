// 숫자판에 누른 대리점 번호가 맞는지 — 맞으면 그 대리점 상호를 돌려준다.
// 고객 화면에 "○○○ 원격지원" 이 떠야 담당자가 번호를 잘못 불러 줬을 때 바로 드러난다.
// 로그인 없이 열려 있다(포스 앞의 사장님이 누르는 화면). 번호를 훑어 대리점 상호를 긁지
// 못하게 횟수만 묶는다.

import { findTenantByQuickCode } from "@/lib/data/quick-support";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ip = clientIp(req) ?? "unknown";
  const rl = rateLimit(`qs-check:${ip}`, 15, 60_000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);
  const code = new URL(req.url).searchParams.get("code") ?? "";
  try {
    const t = await findTenantByQuickCode(code);
    return Response.json(t ? { ok: true, name: t.name } : { ok: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[qs-check]", e instanceof Error ? e.message : e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
