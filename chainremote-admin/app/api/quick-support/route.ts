// GET /api/quick-support — 로그인 없이 받는 "임시 원격" 실행 파일.
//
// 626.kr 첫 화면의 [원격지원 받기] 버튼이 여기로 온다. 무엇을 왜 주는지는 lib/quick-support.ts.
//
// 리다이렉트가 아니라 패널이 직접 내려준다 — **파일 이름이 곧 설정**이라 Content-Disposition 을
//   우리가 정해야 한다. NAS 로 넘기면 브라우저가 URL 에서 이름을 추측하는데, `=`·`,` 가 든
//   이름을 브라우저마다 다르게 풀면 조용히 상류 기본 서버(rustdesk.com)로 붙는 파일이 된다.

import { createHash } from "node:crypto";
import {
  CLIENT_HINT_HEADERS,
  QUICK_SUPPORT_BUILDS,
  QUICK_SUPPORT_SOURCES,
  QUICK_CODE_RE,
  pickQuickSupportBuild,
  quickSupportFilename,
  readClientHints,
  shouldAskForHints,
} from "@/lib/quick-support";
import { createQuickSupportSession, findTenantByQuickCode } from "@/lib/data/quick-support";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// 원본은 바뀌지 않는 파일이라(해시 고정) 한 번 받은 것을 프로세스가 사는 동안 들고 있는다.
const cache = new Map<string, Buffer>();

async function load(arch: "x64" | "x86"): Promise<Buffer | null> {
  const b = QUICK_SUPPORT_BUILDS[arch];
  const hit = cache.get(b.sha256);
  if (hit) return hit;
  for (const base of QUICK_SUPPORT_SOURCES) {
    try {
      const resp = await fetch(`${base}/${b.source}`, { cache: "no-store" });
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      // 해시가 다르면 절대 내주지 않는다 — 서명·평판을 빌리는 전제가 "한 바이트도 안 고친 원본"이다.
      if (createHash("sha256").update(buf).digest("hex") !== b.sha256) {
        console.error("[quick-support] sha mismatch", base, b.source);
        continue;
      }
      cache.set(b.sha256, buf);
      return buf;
    } catch {
      // 다음 후보로
    }
  }
  return null;
}

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;font-family:system-ui,'Malgun Gothic',sans-serif;background:#2b364f;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center"><div style="max-width:28rem;padding:2rem;text-align:center"><h1 style="font-size:1.4rem;margin:0 0 .8rem">${title}</h1><p style="line-height:1.7;color:#d7dcea">${body}</p><p style="margin-top:1.5rem"><a href="/login" style="color:#8fb3ff">← 돌아가기</a></p></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request) {
  const ip = clientIp(req) ?? "unknown";
  // 24MB 를 내주는 무로그인 주소다 — 한 곳에서 연달아 긁어가면 클라우드 트래픽 한도를 먹는다.
  const rl = rateLimit(`quick-support:${ip}`, 6, 60_000);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterSec);

  // 대리점 번호(숫자판에서 누른 값). 있으면 그 대리점 앞으로 세션을 만들고, 받은 파일이
  // 스스로 ID 를 알려 오게 한다. 없으면 종전 방식(고객이 9자리를 불러 준다) 그대로.
  const params = new URL(req.url).searchParams;
  const code = (params.get("code") ?? "").trim();
  const codeQuery = QUICK_CODE_RE.test(code) ? `&code=${code}` : "";

  const hints = readClientHints(req.headers);
  // 크롬 계열이 힌트 없이 왔으면 Critical-CH 로 되묻는다 — 브라우저가 이 응답을 버리고 힌트를
  //   붙여 같은 요청을 다시 보낸다(사람 눈엔 안 보인다). 되묻기가 안 통하는 브라우저를 위해
  //   몸통은 2초 뒤 32비트 판으로 가는 안내를 담는다.
  if (shouldAskForHints(hints) && !params.has("fallback")) {
    const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="refresh" content="2;url=/api/quick-support?fallback=1${codeQuery}"><title>원격지원 준비</title><body style="font-family:system-ui,'Malgun Gothic',sans-serif;background:#2b364f;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0"><div style="max-width:26rem;padding:2rem;text-align:center;line-height:1.8"><p style="font-size:1.2rem;margin:0 0 1rem">파일을 준비하고 있습니다…</p><p style="color:#d7dcea;margin:0">받아지면 그 파일을 눌러 <b style="color:#fff">실행</b>해 주세요.<br>잠시 뒤 작은 창이 뜨면 <b style="color:#fff">수락</b> 을 눌러 주세요.</p></div></body></html>`;
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...CLIENT_HINT_HEADERS },
    });
  }
  const arch = pickQuickSupportBuild(hints);
  if (!arch) {
    return page(
      200,
      "Windows 컴퓨터에서 열어 주세요",
      "원격지원은 Windows 컴퓨터(포스·키오스크)에서 받습니다. 지원받을 컴퓨터의 인터넷 주소창에 <b>626.kr</b> 을 치고 같은 버튼을 눌러 주세요.",
    );
  }
  const buf = await load(arch);
  if (!buf) {
    return page(
      502,
      "잠시 후 다시 눌러 주세요",
      "파일을 준비하지 못했습니다. 1분 뒤 다시 시도해 주시고, 계속 안 되면 담당자에게 전화해 주세요.",
    );
  }
  let name = quickSupportFilename();
  if (code) {
    // 번호가 틀리면 파일을 주지 않는다 — 엉뚱한 대리점(또는 아무도 안 보는 곳)으로 가는
    // 세션을 만드느니 화면에서 다시 누르게 한다.
    const tenant = await findTenantByQuickCode(code).catch(() => null);
    if (!tenant) {
      return page(
        400,
        "번호를 다시 확인해 주세요",
        "담당자가 불러 준 번호와 다릅니다. 돌아가서 번호를 다시 눌러 주세요.",
      );
    }
    try {
      const session = await createQuickSupportSession({ tenantId: tenant.id, arch, ip });
      name = session.filename;
    } catch (e) {
      // 세션을 못 만들어도 원격 자체는 되게 한다 — 종전 이름으로 주면 9자리를 불러 붙을 수 있다.
      console.error("[quick-support] session create failed", e instanceof Error ? e.message : e);
    }
  }
  console.log(
    "[quick-support] served", arch, ip,
    "bitness=", hints.bitness, "pv=", hints.platformVersion, "code=", code || "-",
  );
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(buf.length),
      // 이름에 쉼표·등호가 있어 따옴표로 감싼다. 비ASCII 가 없어 filename* 는 필요 없다.
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      ...CLIENT_HINT_HEADERS,
    },
  });
}
