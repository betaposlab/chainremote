// GET /api/agent-push-meta — 푸시 다이얼로그 [최신 가져오기] 서버사이드 프록시.
//
// NAS Web Station 의 agent-push.json 은 패널(:3443)과 포트가 달라 브라우저에선
// cross-origin — 파일은 200 이지만 ACAO 헤더가 없어 브라우저만 CORS 로 막는다.
// 서버↔서버 fetch 는 CORS 무관이라 여기서 받아 같은 출처로 되돌려준다.
//
// 컨테이너에서 도달 가능한 후보 순차 시도 (공인 DDNS hairpin → NAS LAN IP).
//
// requireApiAuth: 이 라우트 자체는 공개 정적 파일(agent-push.json)만 그대로 되돌려주므로
// 정보 노출 위험은 없지만, 프로젝트 전체 /api/* 관례(모든 라우트가 자체 인증)와 일관되게
// 로그인 세션 없이는 호출 못 하게 막는다 — 로그아웃 상태에서 굳이 열어둘 이유가 없다.

import { requireApiAuth, jsonError } from "@/lib/api-auth";

const META_CANDIDATES = [
  "https://sepani.synology.me/chainremote/agent-push.json",
  "http://192.168.68.103/chainremote/agent-push.json",
];

type Meta = { version: string; url: string; sha256: string; size: number };

function parseMeta(j: Record<string, unknown>): Meta | null {
  const version = typeof j.version === "string" ? j.version : "";
  const url = typeof j.url === "string" ? j.url : "";
  const sha256 = typeof j.sha256 === "string" ? j.sha256 : "";
  const size = typeof j.size === "number" ? j.size : 0;
  if (!version || !url || !sha256 || size <= 0) return null;
  return { version, url, sha256, size };
}

export async function GET(req: Request) {
  try {
    await requireApiAuth(req);
  } catch (e) {
    return jsonError(e);
  }

  const errors: string[] = [];
  for (const candidate of META_CANDIDATES) {
    try {
      const resp = await fetch(candidate, { cache: "no-store" });
      if (!resp.ok) {
        errors.push(`${candidate} → HTTP ${resp.status}`);
        continue;
      }
      const j = (await resp.json()) as Record<string, unknown>;
      const meta = parseMeta(j);
      if (!meta) {
        errors.push(`${candidate} → 형식 오류`);
        continue;
      }
      return Response.json(meta);
    } catch (e) {
      errors.push(`${candidate} → ${String(e)}`);
    }
  }
  return Response.json(
    { error: "agent-push.json 못 가져옴", detail: errors },
    { status: 502 },
  );
}
