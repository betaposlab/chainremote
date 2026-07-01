import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CustomerForm } from "../_form";
import { createCustomer } from "@/lib/actions/customers";
import { listTenantStaff } from "@/lib/data/users";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const staff = await listTenantStaff(session.user.tenantId);

  return (
    <div className="px-8 py-6 max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">거래처 추가</h1>
        <p className="text-sm text-slate-500 mt-1">
          상호와 연락처만 필수. 나머지는 나중에 채워도 OK.
        </p>
      </header>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <CustomerForm action={createCustomer} submitLabel="거래처 추가" staff={staff} />
      </div>
    </div>
  );
}
