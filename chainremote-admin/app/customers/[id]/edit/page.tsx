import { db } from "@/lib/db";
import { customers, tenants } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
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
  const session = await auth();
  if (!session?.user) redirect("/login");
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
    <div className="px-8 py-6 max-w-2xl">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">거래처 수정</h1>
          <p className="text-sm text-slate-500 mt-1">{row.name}</p>
        </div>
        <DeleteButton id={id} name={row.name} />
      </header>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
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
