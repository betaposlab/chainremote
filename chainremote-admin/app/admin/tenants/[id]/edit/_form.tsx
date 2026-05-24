"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { updateTenantFromForm } from "@/lib/actions/tenants";
import { FormattedInput } from "../../_formatted-input";

type TenantData = {
  id: string;
  displayName: string;
  businessNo: string | null;
  representativeName: string | null;
  businessAddress: string | null;
  businessType: string | null;
  businessItem: string | null;
  companyPhone: string | null;
  representativePhone: string | null;
  contactPhone: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
  monthlyFeeKrw: number | null;
  paymentDay: number | null;
  paymentMethod: "cms" | "bank_transfer" | "credit_card" | null;
  subscriptionStartedAt: string | null; // YYYY-MM-DD
  notes: string | null;
};

export function EditTenantForm({ tenant }: { tenant: TenantData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await updateTenantFromForm(tenant.id, fd);
        router.push("/admin/tenants");
      } catch (err: any) {
        setError(err?.message ?? "수정 실패");
      }
    });
  }

  const v = (x: string | number | null) => (x == null ? "" : String(x));

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <Section title="회사 정보 (사업자등록증)">
        <Field label="회사명" required>
          <input name="displayName" required defaultValue={tenant.displayName} className={inp} />
        </Field>
        <Field label="사업자등록번호" hint="숫자만 입력하면 자동 하이픈">
          <FormattedInput type="businessNo" name="businessNo" defaultValue={v(tenant.businessNo)} className={inp} />
        </Field>
        <Field label="대표자명">
          <input name="representativeName" defaultValue={v(tenant.representativeName)} className={inp} />
        </Field>
        <Field label="사업장 주소" wide>
          <input name="businessAddress" defaultValue={v(tenant.businessAddress)} className={inp} />
        </Field>
        <Field label="업태">
          <input name="businessType" defaultValue={v(tenant.businessType)} className={inp} />
        </Field>
        <Field label="종목">
          <input name="businessItem" defaultValue={v(tenant.businessItem)} className={inp} />
        </Field>
      </Section>

      <Section title="연락처">
        <Field label="회사 전화" hint="서울 02 / 지방 0XX / 070 자동 감지">
          <FormattedInput type="phone" name="companyPhone" defaultValue={v(tenant.companyPhone)} className={inp} />
        </Field>
        <Field label="대표자 휴대폰">
          <FormattedInput type="phone" name="representativePhone" defaultValue={v(tenant.representativePhone)} className={inp} />
        </Field>
        <Field label="담당자 휴대폰">
          <FormattedInput type="phone" name="contactPhone" defaultValue={v(tenant.contactPhone)} className={inp} />
        </Field>
      </Section>

      <Section title="결제 계좌 (통장사본)">
        <Field label="은행">
          <input name="bankName" defaultValue={v(tenant.bankName)} className={inp} />
        </Field>
        <Field label="계좌번호">
          <input name="bankAccount" defaultValue={v(tenant.bankAccount)} className={inp} />
        </Field>
        <Field label="예금주">
          <input name="bankHolder" defaultValue={v(tenant.bankHolder)} className={inp} />
        </Field>
      </Section>

      <Section title="구독 / 요금">
        <Field label="월정액 (원, 부가세 별도)" hint="청구서엔 +VAT 10% 자동 표시">
          <input
            name="monthlyFeeKrw"
            type="number"
            min="0"
            step="1000"
            defaultValue={v(tenant.monthlyFeeKrw)}
            className={inp}
          />
        </Field>
        <Field label="결제일 (1~31)">
          <input
            name="paymentDay"
            type="number"
            min="1"
            max="31"
            defaultValue={v(tenant.paymentDay)}
            className={inp}
          />
        </Field>
        <Field label="결제 방식">
          <select name="paymentMethod" className={inp} defaultValue={tenant.paymentMethod ?? ""}>
            <option value="">(미지정)</option>
            <option value="bank_transfer">계좌이체</option>
            <option value="cms">CMS</option>
            <option value="credit_card">신용카드</option>
          </select>
        </Field>
        <Field label="가입일 (구독 시작)">
          <input
            name="subscriptionStartedAt"
            type="date"
            defaultValue={tenant.subscriptionStartedAt ?? ""}
            className={inp}
          />
        </Field>
        <Field label="비고" wide>
          <textarea
            name="notes"
            rows={2}
            defaultValue={v(tenant.notes)}
            className={inp}
          />
        </Field>
      </Section>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Link
          href="/admin/tenants"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
        >
          취소
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[#00A0E5] px-5 py-2 text-sm font-medium text-white hover:bg-[#0086c2] disabled:opacity-50"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}

const inp =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#00A0E5] focus:outline-none focus:ring-1 focus:ring-[#00A0E5]";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <div className="mb-1 text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </div>
      {children}
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </label>
  );
}
