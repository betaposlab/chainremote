// 릴리즈 노트 조회. 전 대리점이 같은 것을 본다 — tenant 격리 대상이 아니다.
//   우리가 무엇을 언제 고쳤는지는 감출 정보가 아니고, 오히려 알려야 문의가 준다.

import { desc, isNotNull, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { releases } from "@/lib/schema";

export const KIND_LABEL: Record<string, string> = {
  agent: "거래처 에이전트",
  hq: "본사 앱 (HQ)",
  chaingo: "ChainGo",
};

/** 채널별 최신 버전 — 대시보드 카드용. */
export async function latestVersions() {
  const rows = await db
    .select({
      kind: releases.kind,
      version: releases.version,
      notes: releases.notes,
      releasedAt: releases.releasedAt,
    })
    .from(releases)
    // 채널마다 가장 최근 1건. 건수가 적어 윈도 함수 대신 distinct on 으로 충분하다.
    .orderBy(releases.kind, desc(releases.releasedAt));

  const seen = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!seen.has(r.kind)) seen.set(r.kind, r);
  return [...seen.values()];
}

/**
 * 전체 이력. 노트가 있는 것만 보여준다 —
 * 내부 수정뿐인 버전까지 나열하면 정작 읽어야 할 것이 묻힌다(행 자체는 남겨 둔다).
 */
export async function listReleases(limit = 50) {
  return db
    .select({
      id: releases.id,
      kind: releases.kind,
      version: releases.version,
      notes: releases.notes,
      releasedAt: releases.releasedAt,
    })
    .from(releases)
    .where(and(isNotNull(releases.notes), sql`btrim(${releases.notes}) <> ''`))
    .orderBy(desc(releases.releasedAt))
    .limit(limit);
}
