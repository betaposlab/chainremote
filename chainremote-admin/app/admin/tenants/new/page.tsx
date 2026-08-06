// 신규 회사 등록 폼 — super_admin 전용.

import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { NewTenantForm } from "./_form";

export const dynamic = "force-dynamic";

export default async function NewTenantPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "super_admin") {
    return (
      <div className="px-4 py-5 md:px-8 md:py-6">
        <h1 className="text-2xl font-bold tracking-tight">신규 회사 등록</h1>
        <p className="mt-2 text-sm text-[#ff9a9e]">
          super_admin 권한이 있어야 이 페이지에 접근할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 md:px-8 md:py-6 max-w-3xl">
      <div className="mb-6">
        <Link
          href="/admin/tenants"
          className="text-sm text-[#b9bfd2] hover:text-[#eef1f7]"
        >
          ← 회사 목록
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          신규 회사 등록
        </h1>
        <p className="mt-1 text-sm text-[#b9bfd2]">
          사업자등록증/통장사본/연락처를 입력하면 회사(tenant) 와 관리자 계정이
          한 번에 생성됩니다. 등록 후 임시 비밀번호가 화면에 표시되니 카톡으로
          전달하세요.
        </p>
      </div>

      <NewTenantForm />
    </div>
  );
}
