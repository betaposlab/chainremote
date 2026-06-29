// 회사(tenant) 목록 — super_admin 전용. 다른 tenant 안 데이터(거래처/세션/이력)
// 는 *조회하지 않음*. 등록일/요금/구독상태/비번 리셋만.

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listTenants, tenantUserCounts } from "@/lib/data/tenants";
import { TenantRowActions } from "./_tenant-row-actions";
import { RolloutAllButton } from "./_rollout-all-button";
// 회사명 클릭 → 수정 페이지. 행 우측 [수정] 버튼도 동일.

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "super_admin") {
    return (
      <div className="px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">회사 관리</h1>
        <p className="mt-2 text-sm text-red-600">
          super_admin 권한이 있어야 이 페이지에 접근할 수 있습니다.
        </p>
      </div>
    );
  }

  const rows = await listTenants();
  const userCounts = await tenantUserCounts();

  return (
    <div className="px-8 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">회사 관리</h1>
          <p className="mt-1 text-sm text-slate-500">
            ChainRemote 를 사용하는 대리점(회사) 목록. 데이터는 각 회사 안에서
            격리되어 운영자(Chang) 는 거래처/세션/이력을 직접 조회하지 않습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RolloutAllButton />
          <Link
            href="/admin/tenants/new"
            className="rounded-md bg-[#00A0E5] px-4 py-2 text-sm font-medium text-white hover:bg-[#0086c2]"
          >
            + 신규 회사 등록
          </Link>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">회사명</th>
              <th className="px-4 py-3">아이디</th>
              <th className="px-4 py-3">대표자</th>
              <th className="px-4 py-3">담당자 연락처</th>
              <th className="px-4 py-3">월정액 (VAT별도)</th>
              <th className="px-4 py-3">결제일</th>
              <th className="px-4 py-3">결제방식</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">가입일</th>
              <th className="px-4 py-3 text-right">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  등록된 회사가 없습니다. 우측 상단의 &quot;신규 회사 등록&quot;
                  으로 시작하세요.
                </td>
              </tr>
            )}
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/tenants/${t.id}/edit`}
                    className="font-medium text-slate-900 hover:text-[#00A0E5] hover:underline"
                  >
                    {t.displayName}
                  </Link>
                  <div className="text-xs text-slate-400">{t.slug}</div>
                  <div className="mt-1">
                    {t.enrollSecretHash ? (
                      <span className="inline-block rounded bg-green-50 px-1.5 py-0.5 text-[11px] text-green-700">
                        🔑 에이전트 키 발급됨
                      </span>
                    ) : (
                      <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                        에이전트 키 미발급
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href="/users"
                    title="사용자 관리에서 회사별로 보기"
                    className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-[#00A0E5] hover:text-white"
                  >
                    {userCounts[t.id] ?? 0}개
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {t.representativeName ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {t.contactPhone ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {t.monthlyFeeKrw != null
                    ? `${t.monthlyFeeKrw.toLocaleString()}원`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {t.paymentDay != null ? `${t.paymentDay}일` : "—"}
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {paymentMethodLabel(t.paymentMethod)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={t.subscriptionStatus} />
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {t.subscriptionStartedAt
                    ? new Date(t.subscriptionStartedAt).toLocaleDateString("ko-KR")
                    : new Date(t.createdAt).toLocaleDateString("ko-KR")}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <Link
                      href={`/admin/tenants/${t.id}/edit`}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      수정
                    </Link>
                    <TenantRowActions
                      tenantId={t.id}
                      displayName={t.displayName}
                      status={
                        t.subscriptionStatus as "active" | "suspended" | "cancelled"
                      }
                      hasEnrollKey={!!t.enrollSecretHash}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
        활성
      </span>
    );
  }
  if (status === "suspended") {
    return (
      <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
        일시정지
      </span>
    );
  }
  return (
    <span className="inline-block rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
      해지
    </span>
  );
}

function paymentMethodLabel(m: string | null): string {
  switch (m) {
    case "cms":
      return "CMS";
    case "bank_transfer":
      return "계좌이체";
    case "credit_card":
      return "신용카드";
    default:
      return "—";
  }
}
