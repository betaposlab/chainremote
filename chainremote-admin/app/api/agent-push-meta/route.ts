// GET /api/agent-push-meta — 푸시 다이얼로그 [최신 가져오기] 서버사이드 프록시.
//
// NAS Web Station 의 agent-push.json 은 패널(:3443)과 포트가 달라 브라우저에선
// cross-origin — 파일은 200 이지만 ACAO 헤더가 없어 브라우저만 CORS 로 막는다.
// 서버↔서버 fetch 는 CORS 무관이라 여기서 받아 같은 출처로 되돌려준다.
//
// 실제 조회는 lib/agent-push-meta.ts 공유 헬퍼 — /api/tenants/[id]/agent(테넌트별
// 오버레이 다운로드)도 같은 헬퍼로 최신 버전을 읽는다(2026-07-08 통합, 별도 "Base" 파일
// 관례 폐기 경위는 그 헬퍼 파일 주석 참조).
//
// requireApiAuth: 이 라우트 자체는 공개 정적 파일(agent-push.json)만 그대로 되돌려주므로
// 정보 노출 위험은 없지만, 프로젝트 전체 /api/* 관례(모든 라우트가 자체 인증)와 일관되게
// 로그인 세션 없이는 호출 못 하게 막는다 — 로그아웃 상태에서 굳이 열어둘 이유가 없다.

import { requireApiAuth, jsonError } from "@/lib/api-auth";
import { fetchAgentPushMetaServer } from "@/lib/agent-push-meta";

export async function GET(req: Request) {
  try {
    await requireApiAuth(req);
  } catch (e) {
    return jsonError(e);
  }

  const result = await fetchAgentPushMetaServer();
  if (!result.meta) {
    return Response.json(
      { error: "agent-push.json 못 가져옴", detail: result.errors },
      { status: 502 },
    );
  }
  return Response.json(result.meta);
}
