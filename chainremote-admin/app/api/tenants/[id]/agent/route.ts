// POST /api/tenants/[id]/agent — 대리점(tenant) 전용 거래처 에이전트 .exe 다운로드.
// 베이스 설치파일 끝에 그 대리점 설정(overlay)을 덧붙여 스트리밍한다. 인스톨러의
// extract-enroll-overlay.ps1 이 overlay 를 custom.txt 로 풀어, 그 .exe 로 깐 가맹점은
// 자동으로 이 대리점 소속(tenant_id)으로 enroll 된다.
//
// enroll-key 는 스테이블(암호화 평문이 있으면 재사용) — 재다운로드해도 같은 키라 이전
// .exe 도 유효하다.
//
// overlay 포맷: [ ...base.exe ][ UTF-8 custom.txt ][ int32 LE length ][ ASCII "CRENROL1" ]

import { auth } from "@/auth";
import { getTenant, getOrCreateEnrollKey } from "@/lib/data/tenants";

export const dynamic = "force-dynamic";

// 베이스 설치파일(빈-키, overlay-capable) URL. NAS 웹에 호스팅. 환경변수로 버전 교체 가능.
const BASE_URL =
  process.env.AGENT_BASE_URL ??
  "https://sepani.synology.me/chainremote/ChainRemote_Agent_Base_v1.4.49.exe";
// 다운로드 파일명 버전 표시용 — 베이스 URL 의 vX.Y.Z 에서 추출(베이스 교체 시 자동 반영).
const BASE_VERSION = BASE_URL.match(/v(\d+\.\d+\.\d+)/)?.[1] ?? "";
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
  const isSuper = me.role === "super_admin";
  const isOwnerOfThis = me.role === "owner" && me.tenantId === id;
  if (!isSuper && !isOwnerOfThis) {
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

  // 3) 베이스 설치파일 로드 (서버측 fetch — CORS 무관, 키는 서버에만).
  let baseBuf: Buffer;
  try {
    const baseResp = await fetch(BASE_URL, { cache: "no-store" });
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

  // 4) overlay 덧붙이기: [base][config][int32 LE len][8-byte magic]
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
  const verSuffix = BASE_VERSION ? `_v${BASE_VERSION}` : "";
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
      "X-Agent-Version": BASE_VERSION,
    },
  });
}
