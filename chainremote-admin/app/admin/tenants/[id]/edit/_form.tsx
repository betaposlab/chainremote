"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { updateTenantFromForm } from "@/lib/actions/tenants";
import { FormattedInput } from "../../_formatted-input";

type TenantData = {
  id: string;
  displayName: string;
  supportDisplayName: string | null;
  businessNo: string | null;
  representativeName: string | null;
  businessAddress: string | null;
  businessType: string | null;
  businessItem: string | null;
  companyPhone: string | null;
  contactEmail: string | null;
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
  maxSeats: number;
  unattendedAgent: boolean;
  hqGreeting: string | null;
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
        <Field label="거래처에 보일 상호" hint="가맹점 수락창에 뜨는 이름. 비우면 회사명 사용">
          <input
            name="supportDisplayName"
            placeholder={tenant.displayName}
            defaultValue={v(tenant.supportDisplayName)}
            className={inp}
          />
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
        {/* 세금계산서·구독 안내가 가는 주소. 로그인 아이디와는 별개다. */}
        <Field label="이메일" hint="세금계산서·안내 메일이 가는 주소. 로그인 아이디와 별개">
          <input
            type="email"
            name="contactEmail"
            defaultValue={v(tenant.contactEmail)}
            className={inp}
            placeholder="billing@example.com"
            autoComplete="off"
          />
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
        <Field
          label="계정 수 (동시 접속 가능 인원)"
          hint="이 대리점이 만들 수 있는 활성 아이디 수. 계정 1개 = 동시 1명 원격. 계정을 더 팔면 이 수를 올린다."
        >
          <input
            name="maxSeats"
            type="number"
            min="1"
            step="1"
            defaultValue={v(tenant.maxSeats)}
            className={inp}
          />
        </Field>
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

      <Section title="특수 설정">
        <Field
          label="무인 접속 허용"
          wide
          hint="켜면 이 대리점의 [에이전트 다운로드] 설치본이 '수락 클릭 없이' 접속을 받는다(영구비번 필요). 가맹점에 설치할 대리점은 절대 켜지 말 것 — 사장님이 매번 수락하는 것이 우리 제품의 약속이다. 본인이 자기 PC 를 보는 전용 대리점에만 쓴다. 켜고 나서 새로 받은 설치본부터 적용된다."
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="unattendedAgent"
              defaultChecked={tenant.unattendedAgent}
              className="h-4 w-4 accent-[#4C7DFF]"
            />
            <span>이 대리점의 에이전트는 수락 클릭 없이 접속을 받는다</span>
          </label>
        </Field>
        <Field
          label="HQ 인사말"
          wide
          hint="이 대리점 계정으로 로그인한 HQ 의 설정 → 정보 화면에서 앱 아이콘을 일곱 번 누르면 뜬다. 비우면 아무 일도 일어나지 않는다."
        >
          <input
            name="hqGreeting"
            defaultValue={v(tenant.hqGreeting)}
            className={inp}
          />
        </Field>
      </Section>

      {error && (
        <div className="banner banner-danger">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Link
          href="/admin/tenants"
          className="rounded-md border border-[#7485ae] bg-[#3d4e7a] px-4 py-2 text-sm hover:bg-white/[0.04]"
        >
          취소
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}

const inp =
  "block w-full rounded-md border border-[#7485ae] bg-[#3d4e7a] px-3 py-2 text-sm focus:border-[#4c7dff] focus:outline-none focus:ring-1 focus:ring-[#4c7dff]";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#566999] bg-[#3d4e7a] p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#b9bfd2]">
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
      <div className="mb-1 text-sm font-medium text-[#eef1f7]">
        {label}
        {required && <span className="ml-1 text-[#ff6b6f]">*</span>}
      </div>
      {children}
      {hint && <div className="mt-1 text-xs text-[#b9bfd2]">{hint}</div>}
    </label>
  );
}
