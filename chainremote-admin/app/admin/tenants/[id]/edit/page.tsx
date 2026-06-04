// 회사(tenant) 정보 수정 — super_admin 전용. 등록 후 사업자/요금/연락처 변경.
// slug 와 관리자 계정은 수정 불가(URL break + 별도 사용자 관리).

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getTenant, listTenantUsers } from "@/lib/data/tenants";
import { EditTenantForm } from "./_form";
import { TenantUsersSection } from "./_users-section";

export const dynamic = "force-dynamic";

export default async function EditTenantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "super_admin") {
    return (
      <div className="px-8 py-6">
        <p className="text-sm text-red-600">super_admin 권한 필요</p>
      </div>
    );
  }

  const { id } = await params;
  const t = await getTenant(id);
  if (!t) notFound();
  const tenantUsers = await listTenantUsers(id);

  return (
    <div className="px-8 py-6 max-w-3xl">
      <div className="mb-6">
        <Link
          href="/admin/tenants"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 회사 목록
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {t.displayName} 정보 수정
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          slug ({t.slug}) 와 관리자 계정은 여기서 수정 불가합니다.
        </p>
      </div>

      <EditTenantForm
        tenant={{
          id: t.id,
          displayName: t.displayName,
          businessNo: t.businessNo,
          representativeName: t.representativeName,
          businessAddress: t.businessAddress,
          businessType: t.businessType,
          businessItem: t.businessItem,
          companyPhone: t.companyPhone,
          representativePhone: t.representativePhone,
          contactPhone: t.contactPhone,
          bankName: t.bankName,
          bankAccount: t.bankAccount,
          bankHolder: t.bankHolder,
          monthlyFeeKrw: t.monthlyFeeKrw,
          paymentDay: t.paymentDay,
          paymentMethod: t.paymentMethod as
            | "cms"
            | "bank_transfer"
            | "credit_card"
            | null,
          subscriptionStartedAt: t.subscriptionStartedAt
            ? t.subscriptionStartedAt.toISOString().slice(0, 10)
            : null,
          notes: t.notes,
        }}
      />

      <TenantUsersSection
        tenantId={t.id}
        users={tenantUsers.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          role: u.role,
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
