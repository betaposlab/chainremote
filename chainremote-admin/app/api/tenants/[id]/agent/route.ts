// POST /api/tenants/[id]/agent — 대리점(tenant) 전용 거래처 에이전트 .exe 다운로드.
// 베이스 설치파일 끝에 그 대리점 설정(overlay)을 덧붙여 스트리밍한다. 인스톨러의
// extract-enroll-overlay.ps1 이 overlay 를 custom.txt 로 풀어, 그 .exe 로 깐 가맹점은
// 자동으로 이 대리점 소속(tenant_id)으로 enroll 된다.
//
// enroll-key 는 스테이블(암호화 평문이 있으면 재사용) — 재다운로드해도 같은 키라 이전
// .exe 도 유효하다.
//
// overlay 포맷: [ ...base.exe ][ UTF-8 custom.txt ][ int32 LE length ][ ASCII "CRENROL1" ]
//
// 베이스 설치파일 소스 — 2026-07-08 이전엔 "ChainRemote_Agent_Base_vX.Y.Z.exe" 라는
// 별도 이름으로 릴리즈마다 손으로 재업로드했는데(에이전트 Setup exe 와 sha256 100% 동일,
// 그냥 복사본이었음), 이 수동 복사가 간헐적으로 깜빡돼(1.4.34→1.4.42→1.4.49, 그 사이
// 다른 버전은 다 누락) 신규 가맹점이 몇 주씩 옛 버전으로 온보딩되는 사고가 났다. 이제
// agent-push.json(publish-agent-push-meta.sh 가 매 릴리즈 자동 갱신)의 url 을 그대로
// 베이스로 쓴다 — 별도 "Base" 파일 자체를 없애 이 채널이 다시는 안 뒤처지게 한다.

import { createHash } from "crypto";
import { auth } from "@/auth";
import { getTenant, getOrCreateEnrollKey } from "@/lib/data/tenants";
import { fetchAgentPushMetaServer } from "@/lib/agent-push-meta";
import { canWrite } from "@/lib/roles";

export const dynamic = "force-dynamic";

const MAGIC = "CRENROL1";

type Ctx = { params: Promise<{ id: string }> };

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(_req: Request, ctx: Ctx) {
  // 브라우저 세션 게이트. super_admin(Chang) 또는 *자기 회사* owner(대리점) 만.
  const session = await auth();
  const me = session?.user;
  if (!me) return jsonError(403, "로그인이 필요합니다");
  const { id } = await ctx.params;
  // 신규 거래처 설치는 직원도 한다(3역할 체계, 2026-07-25) — 자기 회사 것만.
  //   종전엔 owner 전용이라 owner 가 없는 회사에선 아무도 못 받았다. 다른 회사 것은 여전히 차단
  //   (설치본에 그 대리점 enroll-key 가 박히므로 유출되면 멀티테넌트 격리가 깨진다).
  const isSuper = me.role === "super_admin";
  const isMemberOfThis = canWrite(me.role) && me.tenantId === id;
  if (!isSuper && !isMemberOfThis) {
    return jsonError(403, "이 회사의 에이전트를 받을 권한이 없습니다");
  }

  const t = await getTenant(id);
  if (!t) return jsonError(404, "회사를 찾을 수 없습니다");

  // 1) enroll-key — 스테이블(암호화 평문 있으면 재사용, 없으면 발급). 재다운로드해도 같은 키.
  const enrollKey = await getOrCreateEnrollKey(id);

  // 2) 그 대리점 전용 custom.txt (작동 중 betaposlab 에이전트와 동일 포맷).
  const customTxt = JSON.stringify({
    "conn-type": "incoming",
    "tenant-slug": t.slug,
    "enroll-key": enrollKey,
    "default-settings": { "allow-remote-config-modification": "Y" },
    "override-settings": { "approve-mode": "click" },
  });

  // 3) 발행된 최신 버전 조회 (agent-push.json — [최신 가져오기] 버튼과 동일 소스).
  const metaResult = await fetchAgentPushMetaServer();
  if (!metaResult.meta) {
    return jsonError(502, `최신 에이전트 정보 조회 실패: ${metaResult.errors.join("; ")}`);
  }
  const { url: baseUrl, sha256: expectedSha256, version: baseVersion } = metaResult.meta;

  // 4) 베이스 설치파일 로드 (서버측 fetch — CORS 무관, 키는 서버에만) + sha256 무결성 검증.
  let baseBuf: Buffer;
  try {
    const baseResp = await fetch(baseUrl, { cache: "no-store" });
    if (!baseResp.ok) {
      return jsonError(502, `베이스 설치파일 로드 실패 (HTTP ${baseResp.status})`);
    }
    baseBuf = Buffer.from(await baseResp.arrayBuffer());
  } catch {
    return jsonError(502, "베이스 설치파일 서버에 연결할 수 없습니다");
  }
  if (baseBuf.length < 1024) {
    return jsonError(502, "베이스 설치파일이 비정상입니다");
  }
  const actualSha256 = createHash("sha256").update(baseBuf).digest("hex");
  if (actualSha256 !== expectedSha256) {
    return jsonError(
      502,
      "베이스 설치파일 무결성 검증 실패 (agent-push.json 의 sha256 과 불일치) — 신규 가맹점에 손상된 파일을 줄 수 없어 중단",
    );
  }

  // 5) overlay 덧붙이기: [base][config][int32 LE len][8-byte magic]
  const cfg = Buffer.from(customTxt, "utf8");
  const len = Buffer.alloc(4);
  len.writeInt32LE(cfg.length, 0);
  const magic = Buffer.from(MAGIC, "ascii");
  const out = Buffer.concat([baseBuf, cfg, len, magic]);

  // 파일명 = 회사명 기반 (slug 랜덤문자열 노출 방지). 한글이라 RFC 5987(filename*) +
  //   ASCII 폴백(slug) 동시 제공. (fetch+blob 경로는 클라이언트가 a.download 로 최종 결정.)
  const safeName = (
    t.displayName.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim() ||
    t.slug
  ).slice(0, 50);
  const verSuffix = baseVersion ? `_v${baseVersion}` : "";
  const utf8Name = encodeURIComponent(`ChainRemote_${safeName}_가맹점설치용${verSuffix}.exe`);
  const asciiFallback = `ChainRemote_Agent_${t.slug}${verSuffix}.exe`;
  return new Response(new Uint8Array(out), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Name}`,
      "Content-Length": String(out.length),
      "Cache-Control": "no-store",
      // 클라(카드)가 blob 저장 시 파일명에 버전 붙이도록 전달.
      "X-Agent-Version": baseVersion,
    },
  });
}
