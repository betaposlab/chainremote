import { CustomerForm } from "../_form";
import { createCustomer } from "@/lib/actions/customers";

export default function NewCustomerPage() {
  return (
    <div className="px-8 py-6 max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">거래처 추가</h1>
        <p className="text-sm text-slate-500 mt-1">
          상호와 연락처만 필수. 나머지는 나중에 채워도 OK.
        </p>
      </header>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <CustomerForm action={createCustomer} submitLabel="거래처 추가" />
      </div>
    </div>
  );
}
