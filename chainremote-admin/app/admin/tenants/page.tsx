// 회사(tenant) 목록 — super_admin 전용. 각 tenant 내부 데이터(거래처/세션/이력)는 보지 않고
// 등록일/요금/구독상태/비번 리셋만 다룬다.

import Link from "next/link";
import { requireLiveUser } from "@/lib/auth-guard";
import { redirect } from "next/navigation";
import { listTenants, tenantUserCounts } from "@/lib/data/tenants";
import { TenantRowActions } from "./_tenant-row-actions";
// 회사명 클릭 → 수정 페이지. 행 우측 [수정] 버튼도 동일.

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  // 쿠키가 아니라 **계정이 지금도 살아 있는지**를 본다 — 삭제·비활성 계정은 즉시 막힌다.
  //   role 역시 DB 현재값이라 권한 강등이 곧바로 반영된다(lib/auth-guard.ts).
  const session = { user: await requireLiveUser() };
  if (session.user.role !== "super_admin") {
    return (
      <div className="px-4 py-5 md:px-8 md:py-6">
        <h1 className="text-2xl font-bold tracking-tight">회사 관리</h1>
        <p className="mt-2 text-sm text-[#ff9a9e]">
          super_admin 권한이 있어야 이 페이지에 접근할 수 있습니다.
        </p>
      </div>
    );
  }

  const rows = await listTenants();
  const userCounts = await tenantUserCounts();

  return (
    <div className="px-4 py-5 md:px-8 md:py-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">회사 관리</h1>
          <p className="mt-1 text-sm text-[#b9bfd2]">
            ChainRemote 를 사용하는 대리점(회사) 목록. 데이터는 각 회사 안에서
            격리되어 운영자(Chang) 는 거래처/세션/이력을 직접 조회하지 않습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/tenants/new"
            className="btn btn-primary"
          >
            + 신규 회사 등록
          </Link>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-[#566999] bg-[#3d4e7a]">
        <table className="panel-table">
          <thead className="bg-white/[0.025] text-left text-xs uppercase tracking-wider text-[#b9bfd2]">
            <tr>
              <th className="px-4 py-3">회사명</th>
              <th className="px-4 py-3 hidden md:table-cell">아이디</th>
              <th className="px-4 py-3 hidden md:table-cell">대표자</th>
              <th className="px-4 py-3 hidden md:table-cell">담당자 연락처</th>
              <th className="px-4 py-3 hidden md:table-cell">월정액 (VAT별도)</th>
              <th className="px-4 py-3 hidden md:table-cell">결제일</th>
              <th className="px-4 py-3 hidden md:table-cell">결제방식</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3 hidden md:table-cell">가입일</th>
              <th className="px-4 py-3 text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-10 text-center text-[#ccd2e3]"
                >
                  등록된 회사가 없습니다. 우측 상단의 &quot;신규 회사 등록&quot;
                  으로 시작하세요.
                </td>
              </tr>
            )}
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-white/[0.04]">
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/tenants/${t.id}/edit`}
                    className="font-medium text-white hover:text-[#c3d3ff] hover:underline"
                  >
                    {t.displayName}
                  </Link>
                  <div className="text-xs text-[#ccd2e3]">{t.slug}</div>
                  <div className="mt-1">
                    {t.enrollSecretHash ? (
                      <span className="inline-block rounded bg-green-50 px-1.5 py-0.5 text-[11px] text-green-700">
                        🔑 에이전트 키 발급됨
                      </span>
                    ) : (
                      <span className="inline-block rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-[#b9bfd2]">
                        에이전트 키 미발급
                      </span>
                    )}
                  </div>
                </td>
                <td className="hidden md:table-cell px-4 py-3">
                  <Link
                    href="/users"
                    title="사용자 관리에서 회사별로 보기"
                    className="inline-block rounded bg-white/[0.06] px-2 py-0.5 text-xs font-medium text-[#eef1f7] hover:bg-[#4c7dff] hover:text-white"
                  >
                    {userCounts[t.id] ?? 0}개
                  </Link>
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-[#eef1f7]">
                  {t.representativeName ?? "—"}
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-[#eef1f7]">
                  {t.contactPhone ?? "—"}
                  {/* 이메일은 칸을 새로 만들지 않고 아래 줄로 — 칸을 늘리면 좁은 화면에서
                      표가 먼저 깨진다. 없으면 아무것도 안 그린다. */}
                  {t.contactEmail && (
                    <div className="text-xs text-[#9aa3ba]">{t.contactEmail}</div>
                  )}
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-[#eef1f7]">
                  {t.monthlyFeeKrw != null
                    ? `${t.monthlyFeeKrw.toLocaleString()}원`
                    : "—"}
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-[#eef1f7]">
                  {t.paymentDay != null ? `${t.paymentDay}일` : "—"}
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-[#eef1f7]">
                  {paymentMethodLabel(t.paymentMethod)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={t.subscriptionStatus} />
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-[#b9bfd2]">
                  {t.subscriptionStartedAt
                    ? new Date(t.subscriptionStartedAt).toLocaleDateString("ko-KR")
                    : new Date(t.createdAt).toLocaleDateString("ko-KR")}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <Link
                      href={`/admin/tenants/${t.id}/edit`}
                      className="rounded border border-[#7485ae] bg-[#3d4e7a] px-2 py-1 text-xs hover:bg-white/[0.04]"
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
      <span className="inline-block rounded bg-amber-500/12 px-2 py-0.5 text-xs text-amber-300">
        일시정지
      </span>
    );
  }
  return (
    <span className="inline-block rounded bg-white/[0.1] px-2 py-0.5 text-xs text-[#cbd1e0]">
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
