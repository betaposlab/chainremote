import { db } from "@/lib/db";
import { requireLiveUser } from "@/lib/auth-guard";
import { customers, tenants } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { CustomerForm } from "../../_form";
import { updateCustomer } from "@/lib/actions/customers";
import { listTenantStaff } from "@/lib/data/users";
import { listFolders } from "@/lib/data/folders";
import { DeleteButton } from "./_delete";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 테넌트 격리: 로그인 사용자 회사로 한정.
  // 쿠키가 아니라 **계정이 지금도 살아 있는지**를 본다 — 삭제·비활성 계정은 즉시 막힌다.
  //   role 역시 DB 현재값이라 권한 강등이 곧바로 반영된다(lib/auth-guard.ts).
  const session = { user: await requireLiveUser() };
  const tenant = (
    await db.select().from(tenants).where(eq(tenants.id, session.user.tenantId)).limit(1)
  )[0];
  if (!tenant) redirect("/login");

  const row = (
    await db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, tenant.id)))
      .limit(1)
  )[0];

  if (!row) notFound();

  const staff = await listTenantStaff(tenant.id);
  const folderRows = await listFolders(tenant.id);
  // 현재 폴더명(초기값) — folder_id 를 이름으로 되짚는다. 폴더 없으면 빈칸.
  const currentFolderName =
    folderRows.find((f) => f.id === row.folderId)?.name ?? null;
  const update = updateCustomer.bind(null, id);

  return (
    <div className="px-4 py-5 md:px-8 md:py-6 max-w-2xl">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">거래처 수정</h1>
          <p className="text-sm text-[#b9bfd2] mt-1">{row.name}</p>
        </div>
        <DeleteButton id={id} name={row.name} />
      </header>
      <div className="rounded-xl border border-[#566999] bg-[#3d4e7a] p-6">
        <CustomerForm
          initial={{ ...row, folderName: currentFolderName }}
          action={update}
          submitLabel="저장"
          staff={staff}
          folders={folderRows.map((f) => f.name)}
        />
      </div>
    </div>
  );
}
