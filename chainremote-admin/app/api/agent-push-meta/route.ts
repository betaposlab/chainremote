// GET /api/agent-push-meta — 푸시 다이얼로그 [최신 가져오기] 서버사이드 프록시.
//
// NAS Web Station 의 agent-push.json 은 패널(626.kr)과 출처가 달라 브라우저에선
// cross-origin — 파일은 200 이지만 ACAO 헤더가 없어 브라우저만 CORS 로 막는다.
// 서버↔서버 fetch 는 CORS 무관이라 여기서 받아 같은 출처로 되돌려준다.
//
// 실제 조회는 lib/agent-push-meta.ts 공유 헬퍼 — /api/tenants/[id]/agent(테넌트별
// 오버레이 다운로드)도 같은 헬퍼로 최신 버전을 읽는다(2026-07-08 통합, 별도 "Base" 파일
// 관례 폐기 경위는 그 헬퍼 파일 주석 참조).
//
// 인증: 이 라우트는 패널 브라우저 UI([최신 가져오기] 버튼)가 같은 출처 fetch() 로 호출한다
// — NextAuth 세션 쿠키는 있어도 Authorization: Bearer 헤더는 안 보낸다(그건 데스크톱 앱
// 전용, lib/api-auth.ts 참조). ★2026-07-09 사고: 여기 requireApiAuth(Bearer 전용)를 붙였다가
// 브라우저 호출이 전부 401 → 버튼이 다시 죽었다(패널서 "가져오기 실패"로 발견). 다른 브라우저
// 라우트(/api/tenants/[id]/agent 등)와 동일하게 auth() 세션 체크로 되돌린다. 로그인만 돼
// 있으면 role 무관 허용(정보 노출 위험 없는 공개 빌드 메타).

import { getLiveUser } from "@/lib/auth-guard";
import { fetchAgentPushMetaServer } from "@/lib/agent-push-meta";

export async function GET() {
  // 세션 쿠키의 존재가 아니라 계정 생존을 본다 — 퇴사자가 설치파일을 계속 받아가면
  //   차단이 반쪽이다(에이전트 exe 에는 대리점 enroll-key 가 박힌다).
  const session = { user: await getLiveUser() };
  if (!session?.user) {
    return Response.json({ error: "로그인이 필요합니다" }, { status: 403 });
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
