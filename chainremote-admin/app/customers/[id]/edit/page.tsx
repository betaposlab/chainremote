import { db } from "@/lib/db";
import { customers, tenants } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { CustomerForm } from "../../_form";
import { updateCustomer } from "@/lib/actions/customers";
import { DeleteButton } from "./_delete";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // ★ 테넌트 격리: 로그인 사용자 회사로 한정 (하드코딩 betaposlab 제거).
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
        <CustomerForm initial={row} action={update} submitLabel="저장" />
      </div>
    </div>
  );
}
