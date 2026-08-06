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
  assignedUserId?: string | null;
  folderName?: string | null;
};

type Props = {
  initial?: CustomerFormData;
  action: (formData: FormData) => Promise<void>;
  submitLabel?: string;
  staff?: { id: string; displayName: string }[];
  // 이 대리점의 기존 폴더 이름들 — 입력칸 자동완성(datalist)용.
  folders?: string[];
};

export function CustomerForm({
  initial,
  action,
  submitLabel = "저장",
  staff,
  folders,
}: Props) {
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      {staff && staff.length > 0 && (
        <Field label="담당 직원">
          <select
            name="assignedUserId"
            defaultValue={initial?.assignedUserId ?? ""}
            className="input"
          >
            <option value="">(미배정)</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="폴더 (선택)">
        <input
          name="folderName"
          defaultValue={initial?.folderName ?? ""}
          placeholder="낭성"
          list="folder-options"
          className="input"
        />
        {folders && folders.length > 0 && (
          <datalist id="folder-options">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        )}
        <p className="mt-1 text-xs text-[#b9bfd2]">
          같은 매장의 여러 POS 를 한 폴더로 묶습니다. 기존 폴더를 고르거나, 새 이름을
          적으면 폴더가 새로 만들어집니다. 비우면 폴더 없음.
        </p>
      </Field>
      <Field label="원격 ID (선택)">
        <input
          name="remoteId"
          defaultValue={initial?.remoteId ?? ""}
          placeholder="AB12345678 또는 123456789"
          pattern="[A-Za-z0-9 ]*"
          className="input font-mono"
        />
        <p className="mt-1 text-xs text-[#b9bfd2]">
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
        <div className="rounded-md banner banner-danger">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary"
        >
          {pending ? "저장 중..." : submitLabel}
        </button>
        <a
          href="/customers"
          className="btn btn-ghost"
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
      <span className="block text-sm font-medium text-[#eef1f7] mb-1">
        {label}
        {required && <span className="text-[#ff6b6f] ml-1">*</span>}
      </span>
      {children}
    </label>
  );
}
