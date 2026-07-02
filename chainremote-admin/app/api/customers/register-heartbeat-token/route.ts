// POST /api/customers/register-heartbeat-token — 폐기 (2026-07-01, 코워크 검토).
//
// 종전엔 무인증이라 remote_id(9자리, 비밀 아님)만 알면 heartbeat 토큰을 발급/회전시켜
// heartbeat 위조·pending-update 큐 조회가 가능했다. auto-enroll 도입 후로는 온라인
// 거래처가 전부 enroll-key 인증(/api/customers/enroll)으로 토큰을 받고, enroll-key
// 없는 옛 빌드는 오프라인 1대뿐 — 실사용 호출자가 0이라 무인증 경로를 통째로 없앴다.
// (heartbeat 토큰은 패널 가시성/자동업뎃용이라 원격 접속과 무관 — 옛 박스도 원격은 계속
//  됨. 그 박스가 돌아오면 auto-enroll 인스톨러 재설치로 enroll 경로로 넘어간다.)

export async function POST() {
  return Response.json(
    {
      error:
        "이 경로는 폐기되었습니다. 최신 에이전트(auto-enroll)를 설치하세요. (/api/customers/enroll 사용)",
    },
    { status: 410 },
  );
}
