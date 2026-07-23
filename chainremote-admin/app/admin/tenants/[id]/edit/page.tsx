// 회사(tenant) 정보 수정 — super_admin 전용. 사업자/요금/연락처를 바꾼다.
// slug 는 URL 이 깨져서, 관리자 계정은 사용자 관리에서 따로 다뤄서 여기선 못 고친다.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getTenant } from "@/lib/data/tenants";
import { EditTenantForm } from "./_form";

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
          maxSeats: t.maxSeats,
        }}
      />
    </div>
  );
}
