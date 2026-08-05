"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { createTenant, type CreateTenantResult } from "@/lib/actions/tenants";
import { FormattedInput } from "../_formatted-input";

// TODO: 임시 placeholder URL. 호스팅(재성이 홈피 또는 NAS 공개 path) 정해지면 교체.
const HQ_DOWNLOAD_URL = "https://(설정 필요)/ChainRemote_HQ_Setup_v1.3.0.exe";
const CHAINGO_DOWNLOAD_URL = "https://(설정 필요)/ChainGo.exe";

export function NewTenantForm() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateTenantResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const r = await createTenant(fd);
        setResult(r);
      } catch (err: any) {
        setError(err?.message ?? "등록 실패");
      }
    });
  }

  if (result) {
    return <RegisteredResult result={result} />;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <Section title="회사 정보 (사업자등록증)">
        <Field label="회사명" required>
          <input name="displayName" required className={inp} />
        </Field>
        <Field
          label="slug"
          hint="URL 식별자 (영문). 비워두면 자동 생성"
        >
          <input name="slug" className={inp} placeholder="예: jinhee-corp" />
        </Field>
        <Field label="사업자등록번호" hint="숫자만 입력하면 자동 하이픈">
          <FormattedInput type="businessNo" name="businessNo" className={inp} placeholder="000-00-00000" />
        </Field>
        <Field label="대표자명">
          <input name="representativeName" className={inp} />
        </Field>
        <Field label="사업장 주소" wide>
          <input name="businessAddress" className={inp} />
        </Field>
        <Field label="업태">
          <input name="businessType" className={inp} placeholder="예: 서비스업" />
        </Field>
        <Field label="종목">
          <input name="businessItem" className={inp} placeholder="예: POS 유지보수" />
        </Field>
      </Section>

      <Section title="연락처">
        <Field label="회사 전화" hint="서울 02 / 지방 0XX / 070 자동 감지">
          <FormattedInput type="phone" name="companyPhone" className={inp} placeholder="02-0000-0000" />
        </Field>
        <Field label="대표자 휴대폰">
          <FormattedInput type="phone" name="representativePhone" className={inp} placeholder="010-0000-0000" />
        </Field>
        <Field label="담당자 휴대폰" required>
          <FormattedInput type="phone" name="contactPhone" required className={inp} placeholder="010-0000-0000" />
        </Field>
      </Section>

      <Section title="결제 계좌 (통장사본)">
        <Field label="은행">
          <input name="bankName" className={inp} placeholder="예: 국민은행" />
        </Field>
        <Field label="계좌번호">
          <input name="bankAccount" className={inp} />
        </Field>
        <Field label="예금주">
          <input name="bankHolder" className={inp} />
        </Field>
      </Section>

      <Section title="구독 / 요금">
        <Field
          label="월정액 (원, 부가세 별도)"
          required
          hint="청구서엔 +VAT 10% 자동 표시"
        >
          <input
            name="monthlyFeeKrw"
            required
            type="number"
            min="0"
            step="1000"
            className={inp}
            placeholder="25000"
          />
        </Field>
        <Field label="결제일 (1~31)" required>
          <input
            name="paymentDay"
            required
            type="number"
            min="1"
            max="31"
            className={inp}
            placeholder="25"
          />
        </Field>
        <Field label="결제 방식" required>
          <select name="paymentMethod" required className={inp} defaultValue="bank_transfer">
            <option value="bank_transfer">계좌이체</option>
            <option value="cms">CMS</option>
            <option value="credit_card">신용카드</option>
          </select>
        </Field>
        <Field label="가입일 (구독 시작)">
          <input
            name="subscriptionStartedAt"
            type="date"
            className={inp}
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </Field>
        <Field label="비고" wide>
          <textarea
            name="notes"
            rows={2}
            className={inp}
            placeholder="특이사항 / 협상 내용 등"
          />
        </Field>
      </Section>

      <Section title="관리자 계정 (회사 owner)">
        <Field
          label="관리자 아이디"
          required
          hint="HQ 앱 로그인 ID. 이메일 또는 짧은 식별자 (예: jinhee)"
        >
          <input name="adminEmail" required className={inp} />
        </Field>
        <Field label="관리자 표시명" hint="비워두면 회사명 사용">
          <input name="adminDisplayName" className={inp} />
        </Field>
        <Field
          label="초기 비밀번호"
          hint="기본값 1234. 첫 로그인 후 앱에서 자유롭게 변경."
        >
          <input
            name="adminPassword"
            type="text"
            defaultValue="1234"
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
          className="rounded-md border border-[#24375a] bg-[#0d172b] px-4 py-2 text-sm hover:bg-white/[0.04]"
        >
          취소
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary"
        >
          {pending ? "등록 중…" : "등록"}
        </button>
      </div>
    </form>
  );
}

const inp =
  "block w-full rounded-md border border-[#24375a] bg-[#0d172b] px-3 py-2 text-sm focus:border-[#4c7dff] focus:outline-none focus:ring-1 focus:ring-[#4c7dff]";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[#172540] bg-[#0d172b] p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-[#8a93ad]">
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
      <div className="mb-1 text-sm font-medium text-[#c7c9d1]">
        {label}
        {required && <span className="ml-1 text-[#ff6b6f]">*</span>}
      </div>
      {children}
      {hint && <div className="mt-1 text-xs text-[#8a93ad]">{hint}</div>}
    </label>
  );
}

function RegisteredResult({ result }: { result: CreateTenantResult }) {
  const message = `[ChainRemote] ${result.tenantDisplayName} 가입 안내

ChainRemote 본사 앱 (HQ) 다운로드:
${HQ_DOWNLOAD_URL}

ChainGo (외부 비상 도구):
${CHAINGO_DOWNLOAD_URL}

로그인 정보:
- 아이디: ${result.adminEmail}
- 임시 비밀번호: ${result.tempPassword}

첫 로그인 후 앱 [설정] → [비밀번호 변경] 에서 본인 비밀번호로 바꿔주세요.`;

  function copy() {
    void navigator.clipboard.writeText(message);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-4">
        <h2 className="text-lg font-semibold text-green-800">
          ✅ {result.tenantDisplayName} 등록 완료
        </h2>
        <p className="mt-1 text-sm text-green-700">
          관리자 계정이 생성됐고 임시 비밀번호가 발급됐습니다. 아래 메시지를
          그대로 복사해서 회사에 카톡으로 전달하세요.
        </p>
      </div>

      <div className="rounded-lg border border-[#172540] bg-[#0d172b] p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#8a93ad]">
          카톡 전달 메시지
        </h3>
        <pre className="whitespace-pre-wrap break-all rounded-md bg-[#0b0c0e] border border-[#172540] px-3 py-3 text-sm font-mono text-[#c7c9d1]">
{message}
        </pre>
        <p className="mt-3 text-xs text-amber-300">
          ⚠️ 임시 비밀번호는 이 화면에서만 확인 가능합니다. DB 엔 hash 만 저장돼서
          다시 못 봅니다. 분실 시엔 회사 목록에서 [비번 리셋] 으로 새 비밀번호를
          발급할 수 있습니다.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={copy}
            className="btn btn-primary"
          >
            카톡 메시지 복사
          </button>
          <Link
            href="/admin/tenants"
            className="rounded-md border border-[#24375a] bg-[#0d172b] px-4 py-2 text-sm hover:bg-white/[0.04]"
          >
            회사 목록으로
          </Link>
        </div>
      </div>
    </div>
  );
}
