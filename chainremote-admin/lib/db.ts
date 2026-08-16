import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// 프로덕션: DATABASE_URL 로 pg Pool 을 lazy 생성.
// 테스트: 통합 테스트가 globalThis.__CR_TEST_DB__ 에 pglite drizzle 을 주입한다.
//   db 를 Proxy 로 감싸 "쿼리 시점"에 대상(테스트 주입본 또는 실 pool)을 고른다 —
//   ESM 싱글턴이 import 시점에 굳어버려 테스트가 못 갈아끼우는 문제를 피한다.
//   전역 미설정(프로덕션)이면 실 pool 이라 동작·성능 영향 0.
let _real: ReturnType<typeof drizzle> | null = null;
function real() {
  if (!_real) {
    // connectionTimeoutMillis 없으면 DB 가 "거부"가 아니라 "무응답"일 때 커넥션 획득이 영원히
    //   기다려 풀이 조용히 고갈된다(2026-08-16 감사 S1). 요청은 5초 안에 실패하는 편이
    //   낫다 — 클라이언트(에이전트·HQ)는 5xx 를 일시 오류로 보고 다음 주기에 다시 온다.
    _real = drizzle(
      new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        connectionTimeoutMillis: 5_000,
      }),
    );
  }
  return _real;
}

export const db: ReturnType<typeof drizzle> = new Proxy(
  {} as ReturnType<typeof drizzle>,
  {
    get(_t, prop) {
      const injected = (globalThis as Record<string, unknown>).__CR_TEST_DB__ as
        | ReturnType<typeof drizzle>
        | undefined;
      const target = injected ?? real();
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === "function"
        ? (v as (...a: unknown[]) => unknown).bind(target)
        : v;
    },
  },
);
