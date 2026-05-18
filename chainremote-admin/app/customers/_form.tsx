"use client";

import { useState, useTransition } from "react";
import { generatePassword } from "@/lib/password-gen";

export type CustomerFormData = {
  name?: string | null;
  contactName?: string | null;
  phone?: string | null;
  address?: string | null;
  remoteId?: string | null;
  accessPassword?: string | null;
  notes?: string | null;
};

type Props = {
  initial?: CustomerFormData;
  action: (formData: FormData) => Promise<void>;
  submitLabel?: string;
};

export function CustomerForm({ initial, action, submitLabel = "저장" }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(fd) =>
        start(async () => {
          setError(null);
          try {
            await action(fd);
          } catch (e) {
            setError(e instanceof Error ? e.message : "저장 실패");
          }
        })
      }
      className="space-y-4"
    >
      <Field label="상호 *" required>
        <input
          name="name"
          required
          defaultValue={initial?.name ?? ""}
          placeholder="대전 성심분식"
          className="input"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="담당자">
          <input
            name="contactName"
            defaultValue={initial?.contactName ?? ""}
            placeholder="김사장"
            className="input"
          />
        </Field>
        <Field label="연락처">
          <input
            name="phone"
            defaultValue={initial?.phone ?? ""}
            placeholder="042-555-1234"
            className="input"
          />
        </Field>
      </div>
      <Field label="주소">
        <input
          name="address"
          defaultValue={initial?.address ?? ""}
          placeholder="대전 중구 OO로 12"
          className="input"
        />
      </Field>
      <Field label="원격 ID (9자리, 선택)">
        <input
          name="remoteId"
          defaultValue={initial?.remoteId ?? ""}
          placeholder="123456789"
          pattern="[0-9 ]*"
          className="input font-mono"
        />
        <p className="mt-1 text-xs text-slate-500">
          한 번이라도 원격 접속해본 거래처면 ID 입력해두면 다음부턴 1-클릭 접속.
        </p>
      </Field>
      <Field label="메모">
        <textarea
          name="notes"
          defaultValue={initial?.notes ?? ""}
          rows={3}
          placeholder="POS+키오스크 2대 / 점심시간 피해서 연락"
          className="input"
        />
      </Field>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#00A0E5] hover:bg-[#0090d0] disabled:opacity-50 text-white px-5 py-2 text-sm font-medium"
        >
          {pending ? "저장 중..." : submitLabel}
        </button>
        <a
          href="/customers"
          className="rounded-lg border border-slate-200 hover:bg-slate-50 px-5 py-2 text-sm"
        >
          취소
        </a>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </span>
      {children}
    </label>
  );
}
