import { redirect } from "next/navigation";
import { requireLiveUser } from "@/lib/auth-guard";
import { CustomerForm } from "../_form";
import { createCustomer } from "@/lib/actions/customers";
import { listTenantStaff } from "@/lib/data/users";
import { listFolders } from "@/lib/data/folders";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  // 쿠키가 아니라 **계정이 지금도 살아 있는지**를 본다 — 삭제·비활성 계정은 즉시 막힌다.
  //   role 역시 DB 현재값이라 권한 강등이 곧바로 반영된다(lib/auth-guard.ts).
  const session = { user: await requireLiveUser() };
  const staff = await listTenantStaff(session.user.tenantId);
  const folderNames = (await listFolders(session.user.tenantId)).map((f) => f.name);

  return (
    <div className="px-4 py-5 md:px-8 md:py-6 max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">거래처 추가</h1>
        <p className="text-sm text-[#b9bfd2] mt-1">
          상호와 연락처만 필수. 나머지는 나중에 채워도 OK.
        </p>
      </header>
      <div className="rounded-xl border border-[#566999] bg-[#3d4e7a] p-6">
        <CustomerForm
          action={createCustomer}
          submitLabel="거래처 추가"
          staff={staff}
          folders={folderNames}
        />
      </div>
    </div>
  );
}
