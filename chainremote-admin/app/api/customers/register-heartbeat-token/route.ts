// POST /api/customers/register-heartbeat-token — [폐기됨 2026-07-01, 코워크 검토 H2]
//
// 종전: 무인증. 유효한 remote_id(9자리, 비밀 아님)만 POST 하면 heartbeat 토큰을 새로 발급/회전.
//   → remote_id 를 알거나 스캔하면 토큰 탈취 + heartbeat 위조/pending-update 큐 조회 가능(H2).
//
// 폐기 근거: ⑤ auto-enroll 도입 후 온라인 거래처 전량이 per-tenant enroll-key 인증(/api/customers/enroll)
//   으로 토큰을 받는다(agent acquire_token: enroll-key 있으면 enroll, 없으면 이 경로 폴백이었음).
//   enroll-key 없는 옛 빌드는 오프라인 1대뿐 → 실사용 호출자 0. 무인증 발급 경로를 완전 제거해 H2 박멸.
//   (heartbeat 토큰은 패널 가시성/자동업뎃용이지 원격 접속과 무관 — 옛 박스도 원격은 계속 가능.
//    옛 박스가 돌아오면 auto-enroll 인스톨러 재설치로 enroll 경로 전환.)

export async function POST() {
  return Response.json(
    {
      error:
        "이 경로는 폐기되었습니다. 최신 에이전트(auto-enroll)를 설치하세요. (/api/customers/enroll 사용)",
    },
    { status: 410 },
  );
}
