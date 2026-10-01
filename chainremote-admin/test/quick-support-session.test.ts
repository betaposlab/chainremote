import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { quickSupportSessions, tenants } from "@/lib/schema";
import {
  QUICK_SUPPORT_HOST,
  QUICK_SUPPORT_KEY,
  QUICK_SUPPORT_REPORT_BASE,
  quickSupportFilenameWithToken,
} from "@/lib/quick-support";
import {
  createQuickSupportSession,
  findTenantByQuickCode,
  getQuickCode,
  listQuickSupportWaiting,
  recordQuickSupportReport,
} from "@/lib/data/quick-support";
import { POST as reportPOST } from "@/app/api/qs/[token]/api/[kind]/route";
import { GET as checkGET } from "@/app/api/quick-support/check/route";
import { GET as waitingGET } from "@/app/api/quick-support/waiting/route";

// 임시 원격 자가 신고(2026-10-01). 고객 PC 는 상류 RustDesk 공식 exe 라 우리가 못 고친다 —
// 그쪽이 읽는 파일 이름 형식과 그쪽이 기대하는 응답 형식을 여기서 못 박는다.

/** 상류 파서(src/custom_server.rs get_custom_server_from_string)를 그대로 옮긴 것. */
function upstreamParse(filename: string): Record<string, string> | null {
  let s = filename;
  if (s.toLowerCase().endsWith(".exe.exe")) s = s.slice(0, -8);
  else if (s.toLowerCase().endsWith(".exe")) s = s.slice(0, -4);
  if (s.toLowerCase().includes("host=")) return null; // 다른 형식
  s = s.replace("-licensed---", "--").replace("-licensed--", "--").replace("-licensed-", "--");
  const decode = (part: string) => {
    try {
      const rev = part.trim().split("").reverse().join("");
      if (!/^[A-Za-z0-9_-]+$/.test(rev)) return null;
      return JSON.parse(Buffer.from(rev, "base64url").toString("utf8")) as Record<string, string>;
    } catch {
      return null;
    }
  };
  for (const part of s.split("--")) {
    const lic = decode(part);
    if (lic) return lic;
    if (part.includes("(")) {
      for (const p of part.split("(")) {
        const l = decode(p);
        if (l) return l;
      }
    }
  }
  return null;
}

async function seedTenant(slug: string, extra: Partial<typeof tenants.$inferInsert> = {}) {
  const [t] = await testDb()
    .insert(tenants)
    .values({ slug, displayName: slug, ...extra })
    .returning();
  return t;
}

describe("토큰이 실린 파일 이름 — 상류 파서가 읽을 수 있어야 한다", () => {
  it("상류 파서로 풀면 우리 서버·키·토큰 주소가 나온다", () => {
    const name = quickSupportFilenameWithToken("abc123def456");
    // 이 토큰은 안전한 모양이 나오는 값이어야 한다(아니면 아래 다른 테스트가 잡는다).
    expect(name).toBeTruthy();
    const lic = upstreamParse(name!);
    expect(lic).toEqual({
      host: QUICK_SUPPORT_HOST,
      key: QUICK_SUPPORT_KEY,
      api: `${QUICK_SUPPORT_REPORT_BASE}/abc123def456`,
    });
  });

  it('Windows 가 붙이는 " (1)" 이 있어도 풀린다', () => {
    const name = quickSupportFilenameWithToken("abc123def456")!;
    const dup = name.replace(/\.exe$/, " (1).exe");
    expect(upstreamParse(dup)?.api).toBe(`${QUICK_SUPPORT_REPORT_BASE}/abc123def456`);
  });

  it("이름이 Windows 경로 한계 안에 든다 — 길면 브라우저가 잘라 설정이 깨진다", () => {
    const name = quickSupportFilenameWithToken("abc123def456")!;
    // C:\Users\<20자>\Downloads\ ≈ 40자 + " (1)" 4자 여유. 260 한계.
    expect(name.length).toBeLessThan(200);
    expect(/[\\/:*?"<>|]/.test(name)).toBe(false);
  });

  it("토큰 모양이 아니면 null, 파서가 쪼갤 `--` 가 생기는 토큰도 null", () => {
    expect(quickSupportFilenameWithToken("ABC")).toBeNull();
    expect(quickSupportFilenameWithToken("../../etc/pw")).toBeNull();
    // 수천 개를 돌려 보면 null 이 섞여 나와야 하고, null 이 아닌 건 전부 파서가 읽어야 한다.
    let ok = 0;
    for (let i = 0; i < 3000; i++) {
      const token = i.toString(36).padStart(12, "k");
      const n = quickSupportFilenameWithToken(token);
      if (!n) continue;
      ok++;
      expect(n.includes("--")).toBe(false);
      expect(upstreamParse(n)?.api).toBe(`${QUICK_SUPPORT_REPORT_BASE}/${token}`);
    }
    expect(ok).toBeGreaterThan(2000);
  });
});

describe("대리점 번호", () => {
  it("새 대리점은 겹치지 않는 숫자 번호를 자동으로 받는다", async () => {
    const a = await seedTenant("qs-a");
    const b = await seedTenant("qs-b");
    expect(a.quickCode).toMatch(/^[0-9]{3,4}$/);
    expect(b.quickCode).toMatch(/^[0-9]{3,4}$/);
    expect(a.quickCode).not.toBe(b.quickCode);
    expect(await getQuickCode(a.id)).toBe(a.quickCode);
  });

  it("번호 → 대리점. 거래처에 내세우는 상호가 있으면 그걸 준다", async () => {
    const t = await seedTenant("qs-name", { supportDisplayName: "대전문성텔레콤" });
    expect(await findTenantByQuickCode(t.quickCode!)).toEqual({ id: t.id, name: "대전문성텔레콤" });
    expect(await findTenantByQuickCode("999")).toBeNull();
    expect(await findTenantByQuickCode("12")).toBeNull();
    expect(await findTenantByQuickCode("1 OR 1=1")).toBeNull();
  });

  it("정지된 대리점 번호는 없는 번호처럼 답한다", async () => {
    const t = await seedTenant("qs-off", { isActive: false });
    expect(await findTenantByQuickCode(t.quickCode!)).toBeNull();
  });

  it("check 라우트 — 맞으면 상호, 틀리면 ok:false", async () => {
    const t = await seedTenant("qs-check");
    const ok = await checkGET(new Request(`http://x/api/quick-support/check?code=${t.quickCode}`));
    expect(await ok.json()).toEqual({ ok: true, name: "qs-check" });
    const bad = await checkGET(new Request("http://x/api/quick-support/check?code=998"));
    expect(await bad.json()).toEqual({ ok: false });
  });
});

describe("자가 신고 → 대기 목록", () => {
  it("세션 생성 → sysinfo 신고 → 그 대리점 대기 목록에만 뜬다", async () => {
    const a = await seedTenant("qs-wait-a");
    const b = await seedTenant("qs-wait-b");
    const s = await createQuickSupportSession({ tenantId: a.id, arch: "x86", ip: "1.2.3.4" });
    expect(upstreamParse(s.filename)?.api).toBe(`${QUICK_SUPPORT_REPORT_BASE}/${s.token}`);
    // 아직 안 켰다 — 목록에 없다.
    expect(await listQuickSupportWaiting(a.id)).toEqual([]);

    const ok = await recordQuickSupportReport(s.token, {
      remoteId: "447770754",
      hostname: "POS-01",
      os: "windows / Windows 7 Professional",
    });
    expect(ok).toBe(true);
    const list = await listQuickSupportWaiting(a.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ remoteId: "447770754", hostname: "POS-01" });
    // 남의 대리점에는 안 보인다.
    expect(await listQuickSupportWaiting(b.id)).toEqual([]);
  });

  it("신호가 끊기면(50초) 목록에서 빠진다", async () => {
    const t = await seedTenant("qs-stale");
    const s = await createQuickSupportSession({ tenantId: t.id, arch: "x64", ip: null });
    await recordQuickSupportReport(s.token, { remoteId: "123456789" });
    await testDb()
      .update(quickSupportSessions)
      .set({ lastSeenAt: new Date(Date.now() - 120_000) })
      .where(eq(quickSupportSessions.token, s.token));
    expect(await listQuickSupportWaiting(t.id)).toEqual([]);
  });

  it("누가 붙어 있는 동안(heartbeat conns)은 대기 목록에서 뺀다", async () => {
    const t = await seedTenant("qs-conn");
    const s = await createQuickSupportSession({ tenantId: t.id, arch: "x64", ip: null });
    await recordQuickSupportReport(s.token, { remoteId: "123456789", connected: true });
    expect(await listQuickSupportWaiting(t.id)).toEqual([]);
    await recordQuickSupportReport(s.token, { remoteId: "123456789", connected: false });
    expect(await listQuickSupportWaiting(t.id)).toHaveLength(1);
  });

  it("모르는 토큰·이상한 ID·하루 지난 토큰은 적지 않는다", async () => {
    const t = await seedTenant("qs-bad");
    const s = await createQuickSupportSession({ tenantId: t.id, arch: "x64", ip: null });
    expect(await recordQuickSupportReport("zzzzzzzzzzzz", { remoteId: "123456789" })).toBe(false);
    expect(await recordQuickSupportReport(s.token, { remoteId: "<script>" })).toBe(false);
    expect(await recordQuickSupportReport(s.token, { remoteId: 12345 })).toBe(false);
    await testDb()
      .update(quickSupportSessions)
      .set({ createdAt: new Date(Date.now() - 25 * 3600_000) })
      .where(eq(quickSupportSessions.token, s.token));
    expect(await recordQuickSupportReport(s.token, { remoteId: "123456789" })).toBe(false);
  });

  it("같은 PC 가 파일을 두 번 받아 켜도 한 줄", async () => {
    const t = await seedTenant("qs-dup");
    const s1 = await createQuickSupportSession({ tenantId: t.id, arch: "x64", ip: null });
    const s2 = await createQuickSupportSession({ tenantId: t.id, arch: "x64", ip: null });
    await recordQuickSupportReport(s1.token, { remoteId: "123456789" });
    await recordQuickSupportReport(s2.token, { remoteId: "123456789" });
    expect(await listQuickSupportWaiting(t.id)).toHaveLength(1);
  });
});

describe("신고 라우트 — 응답 형식은 상류 클라이언트가 정한다", () => {
  const call = (token: string, kind: string, body: unknown) =>
    reportPOST(
      new Request(`http://x/api/qs/${token}/api/${kind}`, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      { params: Promise.resolve({ token, kind }) },
    );

  it('sysinfo 는 정확히 "SYSINFO_UPDATED", heartbeat 는 빈 객체', async () => {
    const t = await seedTenant("qs-route");
    const s = await createQuickSupportSession({ tenantId: t.id, arch: "x86", ip: null });
    const r1 = await call(s.token, "sysinfo", {
      id: "447770754",
      uuid: "x",
      hostname: "POS-01",
      username: "사장님",
      os: "windows / Windows 10",
    });
    expect(r1.status).toBe(200);
    expect(await r1.text()).toBe("SYSINFO_UPDATED");
    const r2 = await call(s.token, "heartbeat", { id: "447770754", uuid: "x", ver: 1004006 });
    expect(await r2.json()).toEqual({});

    const [row] = await testDb()
      .select()
      .from(quickSupportSessions)
      .where(eq(quickSupportSessions.token, s.token));
    expect(row.remoteId).toBe("447770754");
    expect(row.hostname).toBe("POS-01");
    // 계정명은 받아도 저장할 칸이 없다.
    expect(JSON.stringify(row)).not.toContain("사장님");
    expect(await listQuickSupportWaiting(t.id)).toHaveLength(1);
  });

  it("heartbeat 에 conns 가 있으면 대기에서 빠진다", async () => {
    const t = await seedTenant("qs-route-conn");
    const s = await createQuickSupportSession({ tenantId: t.id, arch: "x86", ip: null });
    await call(s.token, "heartbeat", { id: "447770754", conns: [3] });
    expect(await listQuickSupportWaiting(t.id)).toEqual([]);
  });

  it("모르는 토큰·깨진 본문에도 같은 응답 — 고객 PC 가 재시도로 폭주하지 않게", async () => {
    const r1 = await call("zzzzzzzzzzzz", "sysinfo", { id: "447770754" });
    expect(await r1.text()).toBe("SYSINFO_UPDATED");
    const r2 = await call("zzzzzzzzzzzz", "heartbeat", "not json");
    expect(await r2.json()).toEqual({});
    const r3 = await call("zzzzzzzzzzzz", "login-options", {});
    expect(r3.status).toBe(404);
  });
});

describe("대기 목록 라우트", () => {
  it("토큰 없이는 401", async () => {
    const r = await waitingGET(new Request("http://x/api/quick-support/waiting"));
    expect(r.status).toBe(401);
  });
});
