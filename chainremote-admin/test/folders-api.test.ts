// 폴더 API(HQ) 라우트 테스트 — 인증·권한(viewer 차단)·remoteId 배정·cross-tenant 격리.
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { tenants, users, customers } from "@/lib/schema";
import { signApiToken } from "@/lib/api-auth";
import { GET as foldersGET, POST as foldersPOST } from "@/app/api/folders/route";
import {
  DELETE as folderDELETE,
  PATCH as folderPATCH,
} from "@/app/api/folders/[id]/route";
import { POST as assignPOST } from "@/app/api/customers/folder/route";

async function mkTenant(slug: string): Promise<string> {
  const [t] = await testDb()
    .insert(tenants)
    .values({ slug, displayName: slug, isActive: true, subscriptionStatus: "active" })
    .returning({ id: tenants.id });
  return t.id;
}
async function mkUser(tenantId: string, email: string, role: "owner" | "operator" | "viewer"): Promise<string> {
  const [u] = await testDb()
    .insert(users)
    .values({ tenantId, email, passwordHash: "x", displayName: email, role })
    .returning({ id: users.id });
  return u.id;
}
async function mkCustomer(tenantId: string, name: string, remoteId: string): Promise<string> {
  const [c] = await testDb()
    .insert(customers)
    .values({ tenantId, name, remoteId })
    .returning({ id: customers.id });
  return c.id;
}
async function bearer(tenantId: string, role: "owner" | "operator" | "viewer", uid: string): Promise<string> {
  const { token } = await signApiToken({ uid, email: "x@x", displayName: "x", role, tenantId });
  return token;
}
function req(method: string, token: string, body?: unknown): Request {
  return new Request("http://x/api", {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
async function makeFolder(tenantId: string, uid: string, name: string): Promise<{ id: string; name: string }> {
  const res = await foldersPOST(req("POST", await bearer(tenantId, "owner", uid), { name }));
  return (await res.json()).folder;
}

describe("폴더 API (HQ)", () => {
  it("POST /api/folders — owner 폴더 생성", async () => {
    const t = await mkTenant("fa1");
    const uid = await mkUser(t, "o@fa1", "owner");
    const res = await foldersPOST(req("POST", await bearer(t, "owner", uid), { name: "낭성" }));
    expect(res.status).toBe(201);
    expect((await res.json()).folder.name).toBe("낭성");
  });

  it("POST /api/folders — viewer 차단(403)", async () => {
    const t = await mkTenant("fa2");
    const uid = await mkUser(t, "v@fa2", "viewer");
    const res = await foldersPOST(req("POST", await bearer(t, "viewer", uid), { name: "낭성" }));
    expect(res.status).toBe(403);
  });

  it("POST /api/folders — 빈 이름 400", async () => {
    const t = await mkTenant("fa2b");
    const uid = await mkUser(t, "o@fa2b", "owner");
    const res = await foldersPOST(req("POST", await bearer(t, "owner", uid), { name: "  " }));
    expect(res.status).toBe(400);
  });

  it("GET /api/folders — 자기 대리점 폴더만", async () => {
    const t1 = await mkTenant("fa3a");
    const u1 = await mkUser(t1, "o@fa3a", "owner");
    const t2 = await mkTenant("fa3b");
    const u2 = await mkUser(t2, "o@fa3b", "owner");
    await makeFolder(t1, u1, "낭성");
    await makeFolder(t1, u1, "도덕봉가든");
    await makeFolder(t2, u2, "남의폴더");
    const res = await foldersGET(req("GET", await bearer(t1, "owner", u1)));
    const j = await res.json();
    expect(j.folders.length).toBe(2);
    expect(j.folders.map((f: { name: string }) => f.name).sort()).toEqual(["낭성", "도덕봉가든"]);
  });

  it("POST /api/customers/folder — remoteId 로 배정 + 해제", async () => {
    const t = await mkTenant("fa4");
    const uid = await mkUser(t, "o@fa4", "owner");
    const tok = await bearer(t, "owner", uid);
    const c = await mkCustomer(t, "낭성 바코드", "1234500001");
    const f = await makeFolder(t, uid, "낭성");
    // 배정
    const res = await assignPOST(req("POST", tok, { remoteId: "1234500001", folderId: f.id }));
    expect(res.status).toBe(200);
    let [row] = await testDb().select().from(customers).where(eq(customers.id, c));
    expect(row.folderId).toBe(f.id);
    // 해제(folderId 빈값)
    const res2 = await assignPOST(req("POST", tok, { remoteId: "1234500001", folderId: "" }));
    expect(res2.status).toBe(200);
    [row] = await testDb().select().from(customers).where(eq(customers.id, c));
    expect(row.folderId).toBeNull();
  });

  it("POST /api/customers/folder — viewer 차단(403)", async () => {
    const t = await mkTenant("fa5");
    const uid = await mkUser(t, "v@fa5", "viewer");
    await mkCustomer(t, "낭성 바코드", "1234500002");
    const res = await assignPOST(req("POST", await bearer(t, "viewer", uid), { remoteId: "1234500002", folderId: "x" }));
    expect(res.status).toBe(403);
  });

  it("POST /api/customers/folder — 남의 대리점 remoteId 는 404", async () => {
    const t1 = await mkTenant("fa6a");
    const u1 = await mkUser(t1, "o@fa6a", "owner");
    const t2 = await mkTenant("fa6b");
    const u2 = await mkUser(t2, "o@fa6b", "owner");
    await mkCustomer(t2, "남의거래처", "9999900003");
    const f = await makeFolder(t1, u1, "낭성");
    // t1 이 t2 거래처(remoteId) 를 자기 폴더에 배정 시도 → 자기 tenant 에서 그 remoteId 못 찾음.
    const res = await assignPOST(req("POST", await bearer(t1, "owner", u1), { remoteId: "9999900003", folderId: f.id }));
    expect(res.status).toBe(404);
  });

  it("DELETE /api/folders/:id — 삭제", async () => {
    const t = await mkTenant("fa7");
    const uid = await mkUser(t, "o@fa7", "owner");
    const f = await makeFolder(t, uid, "낭성");
    const res = await folderDELETE(req("DELETE", await bearer(t, "owner", uid)), {
      params: Promise.resolve({ id: f.id }),
    });
    expect(res.status).toBe(200);
    const list = await foldersGET(req("GET", await bearer(t, "owner", uid)));
    expect((await list.json()).folders.length).toBe(0);
  });

  it("PATCH /api/folders/:id — 이름 변경", async () => {
    const t = await mkTenant("fa8");
    const uid = await mkUser(t, "o@fa8", "owner");
    const f = await makeFolder(t, uid, "낭성");
    const res = await folderPATCH(
      req("PATCH", await bearer(t, "owner", uid), { name: "낭성지구" }),
      { params: Promise.resolve({ id: f.id }) },
    );
    expect(res.status).toBe(200);
    const list = await foldersGET(req("GET", await bearer(t, "owner", uid)));
    expect((await list.json()).folders[0].name).toBe("낭성지구");
  });

  it("PATCH — 같은 대리점에 이미 있는 이름이면 409", async () => {
    const t = await mkTenant("fa9");
    const uid = await mkUser(t, "o@fa9", "owner");
    await makeFolder(t, uid, "낭성");
    const f2 = await makeFolder(t, uid, "도덕봉가든");
    const res = await folderPATCH(
      req("PATCH", await bearer(t, "owner", uid), { name: "낭성" }),
      { params: Promise.resolve({ id: f2.id }) },
    );
    expect(res.status).toBe(409);
  });

  it("PATCH — viewer 차단(403)", async () => {
    const t = await mkTenant("fa10");
    const owner = await mkUser(t, "o@fa10", "owner");
    const viewer = await mkUser(t, "v@fa10", "viewer");
    const f = await makeFolder(t, owner, "낭성");
    const res = await folderPATCH(
      req("PATCH", await bearer(t, "viewer", viewer), { name: "낭성2" }),
      { params: Promise.resolve({ id: f.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("PATCH — 남의 대리점 폴더는 404", async () => {
    const t1 = await mkTenant("fa11a");
    const u1 = await mkUser(t1, "o@fa11a", "owner");
    const t2 = await mkTenant("fa11b");
    const u2 = await mkUser(t2, "o@fa11b", "owner");
    const fOfT2 = await makeFolder(t2, u2, "남의폴더");
    const res = await folderPATCH(
      req("PATCH", await bearer(t1, "owner", u1), { name: "가로채기" }),
      { params: Promise.resolve({ id: fOfT2.id }) },
    );
    expect(res.status).toBe(404);
  });

  it("PATCH — 빈 이름 400", async () => {
    const t = await mkTenant("fa12");
    const uid = await mkUser(t, "o@fa12", "owner");
    const f = await makeFolder(t, uid, "낭성");
    const res = await folderPATCH(
      req("PATCH", await bearer(t, "owner", uid), { name: "  " }),
      { params: Promise.resolve({ id: f.id }) },
    );
    expect(res.status).toBe(400);
  });
});
