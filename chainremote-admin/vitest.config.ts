import { defineConfig } from "vitest/config";
import path from "node:path";

// 통합 테스트 — pglite 로 실 Postgres 스키마에 대고 데이터 레이어를 두들긴다.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    hookTimeout: 60_000, // pglite 초기화 + 마이그레이션 여유
    fileParallelism: false, // 단일 pglite 인스턴스 공유(테이블 truncate 로 격리)
  },
});
