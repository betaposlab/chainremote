// pglite(WASM 인프로세스 Postgres) 기반 테스트 DB 하네스. Docker 불필요.
// db/migrations + chainremote-admin/migrations 의 실 마이그레이션 SQL 을 파일명 순서대로 전부
// 적용해 프로덕션과 같은 스키마를 만든다(개수 하드코딩 없이 디렉터리 동적 수집) →
// 유니크 인덱스/제약/partial-unique 등 SQL 레벨 동작까지 진짜로 검증(목킹 아님).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle>;
let client: PGlite | null = null;
let _db: TestDb | null = null;

export function testDb(): TestDb {
  if (!_db) throw new Error("initTestDb() 를 먼저 호출하세요");
  return _db;
}

function migrationFiles(): string[] {
  // db/migrations/001+ (레포 루트) + chainremote-admin/migrations/011+ — 있는 .sql 전부 수집.
  const dirs = [
    path.resolve(__dirname, "../../../db/migrations"),
    path.resolve(__dirname, "../../migrations"),
  ];
  const files: string[] = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith(".sql")) files.push(path.join(d, f));
    }
  }
  // 파일명 앞 3자리 번호(001, 002, …)로 정렬 — 디렉터리 무관 전역 순서.
  return files.sort((a, b) =>
    path.basename(a).localeCompare(path.basename(b)),
  );
}

// pglite 호환 전처리(실 마이그레이션 파일은 안 건드림 — 테스트 로드 시점에만 변환).
//   - CREATE EXTENSION uuid-ossp/pgcrypto 제거: pglite 미번들. gen_random_uuid 는 PG15 내장이라 불필요.
//   - uuid_generate_v4() → gen_random_uuid(): 둘 다 랜덤 UUID, pglite 내장 함수로 대체.
function pgliteCompat(ddl: string): string {
  let out = ddl
    .replace(/CREATE\s+EXTENSION[^;]*;/gi, "")
    .replace(/uuid_generate_v4\(\)/gi, "gen_random_uuid()");
  // pglite 는 PK 컬럼의 DROP NOT NULL 을 거부(실 PG 보다 엄격). PK 를 먼저 떼도록
  //   DROP CONSTRAINT ..._pkey 문을 파일 맨 앞으로 끌어올린다(IF EXISTS 라 순서 안전).
  const dropPk = /ALTER\s+TABLE\s+\w+\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+\w+_pkey\s*;/gi;
  const pks = out.match(dropPk);
  if (pks) {
    out = out.replace(dropPk, "");
    out = pks.join("\n") + "\n" + out;
  }
  return out;
}

export async function initTestDb(): Promise<TestDb> {
  client = new PGlite(); // 메모리 전용, 매 프로세스 새것
  for (const f of migrationFiles()) {
    const ddl = pgliteCompat(fs.readFileSync(f, "utf8"));
    try {
      await client.exec(ddl);
    } catch (e) {
      throw new Error(`마이그레이션 실패 (${path.basename(f)}): ${String(e)}`);
    }
  }
  _db = drizzle(client);
  (globalThis as Record<string, unknown>).__CR_TEST_DB__ = _db;
  return _db;
}

// 매 테스트 사이 모든 테이블 비우기(스키마·인덱스는 유지) — 테스트 격리.
export async function resetTables(): Promise<void> {
  if (!client) return;
  const rows = await client.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname='public'`,
  );
  const names = rows.rows.map((r) => `"${r.tablename}"`).join(", ");
  if (names) await client.exec(`TRUNCATE ${names} RESTART IDENTITY CASCADE;`);
}

export { sql };
