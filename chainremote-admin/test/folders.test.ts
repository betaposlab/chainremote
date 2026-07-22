// 거래처 폴더 데이터 레이어(마이그 026) 테스트 — CRUD + tenant 격리 + 폴더 삭제 시 SET NULL.
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { tenants, customers } from "@/lib/schema";
import {
  listFolders,
  createFolder,
  deleteFolder,
  assignFolder,
} from "@/lib/data/folders";

async function mkTenant(slug: string): Promise<string> {
  const [t] = await testDb()
    .insert(tenants)
    .values({ slug, displayName: slug, isActive: true, subscriptionStatus: "active" })
    .returning({ id: tenants.id });
  return t.id;
}
async function mkCustomer(tenantId: string, name: string, remoteId: string): Promise<string> {
  const [c] = await testDb()
    .insert(customers)
    .values({ tenantId, name, remoteId })
    .returning({ id: customers.id });
  return c.id;
}
async function folderIdOf(customerId: string): Promise<string | null> {
  const [row] = await testDb()
    .select({ folderId: customers.folderId })
    .from(customers)
    .where(eq(customers.id, customerId));
  return row.folderId;
}

describe("folders 데이터 레이어 (마이그 026)", () => {
  describe("createFolder", () => {
    it("폴더를 만든다", async () => {
      const t = await mkTenant("f-create");
      const f = await createFolder(t, "낭성");
      expect(f.name).toBe("낭성");
      expect(f.tenantId).toBe(t);
    });
    it("같은 이름은 findOrCreate — 기존 반환(중복 안 만듦)", async () => {
      const t = await mkTenant("f-dup");
      const a = await createFolder(t, "낭성");
      const b = await createFolder(t, "낭성");
      expect(b.id).toBe(a.id);
      expect((await listFolders(t)).length).toBe(1);
    });
    it("앞뒤 공백은 trim", async () => {
      const t = await mkTenant("f-trim");
      const f = await createFolder(t, "  도덕봉가든  ");
      expect(f.name).toBe("도덕봉가든");
    });
    it("빈 이름(공백만) 거부", async () => {
      const t = await mkTenant("f-empty");
      await expect(createFolder(t, "   ")).rejects.toThrow();
    });
  });

  describe("listFolders", () => {
    it("자기 tenant 폴더만, 이름순", async () => {
      const t1 = await mkTenant("f-list1");
      const t2 = await mkTenant("f-list2");
      await createFolder(t1, "낭성");
      await createFolder(t1, "가나상회");
      await createFolder(t2, "남의폴더");
      const list = await listFolders(t1);
      expect(list.map((f) => f.name)).toEqual(["가나상회", "낭성"]); // 이름순, t2 것 안 섞임
    });
  });

  describe("deleteFolder", () => {
    it("자기 tenant 폴더 삭제 + 소속 거래처는 folder_id NULL 로 남는다(SET NULL)", async () => {
      const t = await mkTenant("f-del");
      const f = await createFolder(t, "낭성");
      const c = await mkCustomer(t, "낭성 바코드포스", "1110000001");
      await assignFolder(c, f.id, t);
      expect(await folderIdOf(c)).toBe(f.id);
      expect(await deleteFolder(f.id, t)).toBe(true);
      // 거래처는 살아있고 폴더 연결만 끊긴다(거래처가 삭제되면 안 됨).
      expect(await folderIdOf(c)).toBeNull();
    });
    it("남의 tenant 폴더는 삭제 못 함", async () => {
      const t1 = await mkTenant("f-del-a");
      const t2 = await mkTenant("f-del-b");
      const f = await createFolder(t1, "낭성");
      expect(await deleteFolder(f.id, t2)).toBe(false);
      expect((await listFolders(t1)).length).toBe(1);
    });
  });

  describe("assignFolder", () => {
    it("배정 / 해제(null)", async () => {
      const t = await mkTenant("f-assign");
      const f = await createFolder(t, "낭성");
      const c = await mkCustomer(t, "낭성 바코드포스", "2220000002");
      expect(await assignFolder(c, f.id, t)).toBe(true);
      expect(await folderIdOf(c)).toBe(f.id);
      expect(await assignFolder(c, null, t)).toBe(true);
      expect(await folderIdOf(c)).toBeNull();
    });
    it("남의 tenant 폴더에는 못 넣는다(cross-tenant 차단)", async () => {
      const t1 = await mkTenant("f-x1");
      const t2 = await mkTenant("f-x2");
      const fOfT2 = await createFolder(t2, "남의폴더");
      const c = await mkCustomer(t1, "우리거래처", "3330000003");
      expect(await assignFolder(c, fOfT2.id, t1)).toBe(false);
      expect(await folderIdOf(c)).toBeNull(); // 배정 안 됨
    });
    it("남의 tenant 거래처는 못 건드린다", async () => {
      const t1 = await mkTenant("f-y1");
      const t2 = await mkTenant("f-y2");
      const f = await createFolder(t1, "낭성");
      const cOfT2 = await mkCustomer(t2, "남의거래처", "4440000004");
      expect(await assignFolder(cOfT2, f.id, t1)).toBe(false);
    });
  });
});
