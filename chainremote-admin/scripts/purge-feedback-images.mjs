// 닫힌 문의(반영·보류)의 첨부를 90일 뒤 지운다. 글과 답변은 건드리지 않는다.
//
// 이미지는 재현에 쓰는 임시 증거자료고 우리 자산은 글과 답변이다. 그대로 두면 디스크가
//   계속 누적되므로(대리점 50곳 기준 최악 월 1.5GB) 닫힌 건부터 걷어낸다.
//   백업 대상에서도 뺐다 — 소실돼도 글은 남는다.
//
// 실행: 클라우드에서 하루 한 번.
//   docker exec chainremote-admin node scripts/purge-feedback-images.mjs
//
// ★DB 행을 먼저 지우고 파일을 지운다. 순서가 반대면 파일은 없는데 행이 남아 화면에
//   깨진 이미지가 뜬다. 반대로 이 순서에서는 최악이 "지워진 행의 파일이 남는 것"이고,
//   그건 다음 실행이 걷어내지 못하니 여기서 같이 처리한다.

import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/data/uploads/feedback";
const KEEP_DAYS = Number(process.env.FEEDBACK_IMAGE_KEEP_DAYS || 90);
// 고아 파일(트랜잭션 실패 등으로 DB 에 안 걸린 것)은 하루 지난 것만 건드린다 —
//   방금 업로드 중인 파일을 지우지 않기 위해서다.
const ORPHAN_GRACE_HOURS = 24;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let removed = 0;
let orphans = 0;

try {
  const { rows } = await client.query(
    `DELETE FROM feedback_images fi
       USING feedback f
      WHERE fi.feedback_id = f.id
        AND f.status IN ('done', 'declined')
        AND fi.created_at < now() - ($1 || ' days')::interval
      RETURNING fi.stored_name`,
    [KEEP_DAYS],
  );

  for (const r of rows) {
    try {
      await unlink(path.join(UPLOAD_DIR, r.stored_name));
      removed += 1;
    } catch {
      // 이미 없으면 결과는 같다.
    }
  }

  // 고아 파일 청소 — DB 에 없는데 디스크에만 있는 것.
  const known = new Set(
    (await client.query("SELECT stored_name FROM feedback_images")).rows.map(
      (r) => r.stored_name,
    ),
  );
  let files = [];
  try {
    files = await readdir(UPLOAD_DIR);
  } catch {
    files = [];
  }
  const cutoff = Date.now() - ORPHAN_GRACE_HOURS * 60 * 60 * 1000;
  for (const name of files) {
    if (known.has(name)) continue;
    const p = path.join(UPLOAD_DIR, name);
    try {
      const st = await stat(p);
      if (st.mtimeMs < cutoff) {
        await unlink(p);
        orphans += 1;
      }
    } catch {
      // 경합으로 사라졌으면 넘어간다.
    }
  }

  console.log(
    `[purge-feedback-images] 만료 ${rows.length}건(파일 ${removed}) · 고아 ${orphans} · 보관 ${KEEP_DAYS}일`,
  );
} finally {
  await client.end();
}
