import { beforeAll, beforeEach } from "vitest";
import { initTestDb, resetTables } from "./helpers/db";

// 모든 테스트 파일 공용 — signApiToken / encryptSecret(enroll-key) 가 AUTH_SECRET 을 읽는다.
// 파일별로 세팅하면 실행 순서에 따라 미설정 상태로 먼저 도는 파일이 생기므로 여기서 한 번에.
process.env.AUTH_SECRET ||= "test-secret-chainremote-suite";

// 프로세스 1회: pglite 생성 + 마이그레이션 적용 + globalThis 주입(lib/db 가 이걸 씀).
beforeAll(async () => {
  await initTestDb();
});

// 매 테스트: 테이블 비우기(격리).
beforeEach(async () => {
  await resetTables();
});
