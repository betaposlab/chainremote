import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import { createTenantWithOwner, updateTenant } from "@/lib/data/tenants";
import { tenants } from "@/lib/schema";

// 마이그047 — 대리점 연락 이메일(세금계산서·구독 안내가 가는 주소).
//   ★로그인 아이디(users.email)와 다른 값이다: 아이디는 'chang' 처럼 이메일이 아닐 수 있고
//   청구는 대개 경리 담당자에게 간다. 둘이 섞이면 안 된다.

async function row(id: string) {
  const [t] = await testDb().select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return t;
}

describe("대리점 연락 이메일", () => {
  it("등록 때 저장되고, 로그인 아이디와 별개로 남는다", async () => {
    const { tenant, admin } = await createTenantWithOwner({
      tenant: {
        displayName: "탑아이엔티",
        slug: "topint",
        contactEmail: "billing@topint.co.kr",
      },
      admin: { email: "topint", displayName: "정현호", passwordHash: "x" },
    });
    const t = await row(tenant.id);
    expect(t.contactEmail).toBe("billing@topint.co.kr");
    // 아이디는 이메일 형식이 아니어도 되고, 서로 영향을 주지 않는다.
    expect(admin.email).toBe("topint");
  });

  it("수정으로 채우고 비울 수 있다", async () => {
    const { tenant } = await createTenantWithOwner({
      tenant: { displayName: "달인식자재마트", slug: "chams" },
      admin: { email: "chams", displayName: "만선", passwordHash: "x" },
    });
    expect((await row(tenant.id)).contactEmail).toBeNull();

    await updateTenant(tenant.id, { contactEmail: "master@chams.kr" });
    expect((await row(tenant.id)).contactEmail).toBe("master@chams.kr");

    // 폼에서 지우면 서버 액션이 null 로 넘긴다 — 빈 문자열이 남으면 안 된다.
    await updateTenant(tenant.id, { contactEmail: null });
    expect((await row(tenant.id)).contactEmail).toBeNull();
  });

  it("이메일이 없어도 등록은 된다(선택 항목)", async () => {
    const { tenant } = await createTenantWithOwner({
      tenant: { displayName: "이메일없는곳", slug: "noemail" },
      admin: { email: "noemail", displayName: "사장", passwordHash: "x" },
    });
    expect((await row(tenant.id)).contactEmail).toBeNull();
    expect((await row(tenant.id)).displayName).toBe("이메일없는곳");
  });
});
