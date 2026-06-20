// POST /api/tenants/[id]/agent
//
// 이 대리점(tenant) 전용 거래처 에이전트 설치파일(.exe) 다운로드 — super_admin(Chang) 전용.
//   = enroll-key (재)발급 + 베이스 설치파일 끝에 그 대리점 설정(overlay)을 덧붙여 스트리밍.
//   설치 시 인스톨러의 extract-enroll-overlay.ps1 이 이 overlay 를 읽어 custom.txt 로 적용 →
//   그 .exe 로 깐 가맹점은 자동으로 이 대리점 소속(tenant_id)으로 enroll.
//
// ★ 다운로드할 때마다 키가 (재)발급된다(평문은 DB 에 저장 안 하므로 같은 .exe 재생성 불가).
//   → 받은 .exe 를 보관/배포. 다시 받으면 새 키라 이전 .exe 는 *신규* 등록 불가
//     (이미 등록된 거래처는 heartbeat-token 기반이라 무영향). UI 가 경고.
//
// overlay 포맷(= extract-enroll-overlay.ps1 가 읽는 형식):
//   [ ...base.exe ][ UTF-8 custom.txt ][ int32 LE length ][ 8-byte ASCII "CRENROL1" ]

import { auth } from "@/auth";
import { getTenant, setEnrollSecretHash } from "@/lib/data/tenants";
import {
  generateHeartbeatToken,
  hashHeartbeatToken,
} from "@/lib/heartbeat-token";

export const dynamic = "force-dynamic";

// 베이스 설치파일(빈-키, overlay-capable) URL. NAS 웹에 호스팅. 환경변수로 버전 교체 가능.
const BASE_URL =
  process.env.AGENT_BASE_URL ??
  "https://sepani.synology.me/chainremote/ChainRemote_Agent_Base_v1.4.34.exe";
const MAGIC = "CRENROL1";

type Ctx = { params: Promise<{ id: string }> };

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(_req: Request, ctx: Ctx) {
  // 브라우저 세션 게이트 (데스크톱 Bearer 아님). super_admin 만.
  const session = await auth();
  if (!session?.user || session.user.role !== "super_admin") {
    return jsonError(403, "super_admin 권한이 필요합니다");
  }

  const { id } = await ctx.params;
  const t = await getTenant(id);
  if (!t) return jsonError(404, "회사를 찾을 수 없습니다");

  // 1) enroll-key (재)발급 — DB 엔 해시만 (resolveTenantByEnroll 과 동일 hashHeartbeatToken).
  const enrollKey = generateHeartbeatToken();
  await setEnrollSecretHash(id, hashHeartbeatToken(enrollKey));

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

  // slug 는 [a-z0-9-] 이라 파일명 ASCII 안전.
  const filename = `ChainRemote_Agent_${t.slug}.exe`;
  return new Response(new Uint8Array(out), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(out.length),
      "Cache-Control": "no-store",
    },
  });
}
