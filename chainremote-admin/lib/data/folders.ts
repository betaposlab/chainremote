// 거래처 폴더 데이터 레이어 (마이그 026) — 운영자가 폴더를 만들고 거래처를 직접 배정.
//   자동 그룹핑(이름 접두) 아님. 모든 경로가 tenant 경계를 강제한다(cross-tenant 차단).

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { folders, customers } from "@/lib/schema";

/** 이 대리점(tenant)의 폴더 목록 — 이름순. */
export async function listFolders(tenantId: string) {
  return db
    .select()
    .from(folders)
    .where(eq(folders.tenantId, tenantId))
    .orderBy(asc(folders.name));
}

/** 폴더 생성 — 같은 이름이 이미 있으면 그걸 반환(findOrCreate). 빈 이름 거부. */
export async function createFolder(tenantId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("폴더 이름이 필요합니다");
  const [existing] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.tenantId, tenantId), eq(folders.name, trimmed)))
    .limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(folders)
    .values({ tenantId, name: trimmed })
    .returning();
  return row;
}

/** 폴더 삭제 — 자기 tenant 폴더만. 소속 거래처는 folder_id=NULL 로 남는다(스키마 SET NULL). */
export async function deleteFolder(id: string, tenantId: string): Promise<boolean> {
  const [row] = await db
    .delete(folders)
    .where(and(eq(folders.id, id), eq(folders.tenantId, tenantId)))
    .returning({ id: folders.id });
  return !!row;
}

/**
 * 거래처를 폴더에 배정(또는 folderId=null 로 해제).
 * folderId 가 이 tenant 의 폴더인지, customerId 가 이 tenant 거래처인지 둘 다 검증한다
 * (남의 폴더에 넣기·남의 거래처 건드리기 차단). 어느 하나라도 아니면 false.
 */
export async function assignFolder(
  customerId: string,
  folderId: string | null,
  tenantId: string,
): Promise<boolean> {
  if (folderId !== null) {
    const [f] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.tenantId, tenantId)))
      .limit(1);
    if (!f) return false; // 남의 폴더거나 없는 폴더
  }
  const [row] = await db
    .update(customers)
    .set({ folderId })
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .returning({ id: customers.id });
  return !!row;
}
