// 한글 입력 상태로 친 아이디로도 로그인이 된다 — 배선까지 확인한다.
//
// 순수 변환은 hangul-qwerty.test.ts 가 맡는다. 여기서 보는 건 **로그인 경로가 그 폴백을
// 실제로 쓰는가**다. 표만 맞고 안 불러 주면 아무 일도 안 일어난다.

import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { testDb } from "./helpers/db";
import { POST as tokenPOST } from "@/app/api/auth/token/route";
import { tenants, users } from "@/lib/schema";

async function seed(slug: string, loginId: string, password: string) {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug, isActive: true, subscriptionStatus: "active" })
    .returning({ id: tenants.id });
  await db.insert(users).values({
    tenantId: t.id,
    email: loginId,
    passwordHash: bcrypt.hashSync(password, 10),
    displayName: slug,
    role: "owner",
    isActive: true,
  });
}

const login = (email: string, password: string) =>
  tokenPOST(
    new Request("http://t/api/auth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        deviceId: "dev-1",
        deviceLabel: "테스트",
      }),
    }),
  );

describe("한글로 친 아이디 로그인 (HQ /api/auth/token)", () => {
  it("영문 그대로는 당연히 된다", async () => {
    await seed("h-plain", "chang", "6002");
    expect((await login("chang", "6002")).status).toBe(200);
  });

  it("★한글 상태로 친 '초뭏' 으로도 들어간다", async () => {
    await seed("h-kor", "chang", "6002");
    expect((await login("초뭏", "6002")).status).toBe(200);
  });

  it("모음으로 시작하는 아이디도 — 'jaesung' → 'ㅓㅁㄷ녀ㅜㅎ'", async () => {
    await seed("h-vowel", "jaesung", "6002");
    expect((await login("ㅓㅁㄷ녀ㅜㅎ", "6002")).status).toBe(200);
  });

  it("비번은 구제하지 않는다 — 아이디만 되돌린다", async () => {
    await seed("h-pw", "chang", "6002");
    expect((await login("초뭏", "틀린비번")).status).toBe(401);
  });

  it("아무 한글이나 통과하지 않는다", async () => {
    await seed("h-none", "chang", "6002");
    expect((await login("없는사람", "6002")).status).toBe(401);
  });
});
