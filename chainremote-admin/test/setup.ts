import { beforeAll, beforeEach } from "vitest";
import { initTestDb, resetTables } from "./helpers/db";

// 프로세스 1회: pglite 생성 + 마이그레이션 적용 + globalThis 주입(lib/db 가 이걸 씀).
beforeAll(async () => {
  await initTestDb();
});

// 매 테스트: 테이블 비우기(격리).
beforeEach(async () => {
  await resetTables();
});
