"use client";

import { useState } from "react";
import { createUser } from "@/lib/actions/users";
import { ASSIGNABLE_ROLES } from "@/lib/roles";

export function CreateUserForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(formData: FormData) {
    setError(null);
    setPending(true);
    try {
      await createUser(formData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가 실패");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleAction} className="grid grid-cols-1 gap-3 md:grid-cols-5">
      <input
        name="email"
        type="text"
        required
        placeholder="아이디 (예: jihee)"
        className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-[#00A0E5] focus:outline-none"
      />
      <input
        name="displayName"
        type="text"
        required
        placeholder="이름"
        className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-[#00A0E5] focus:outline-none"
      />
      <input
        name="password"
        type="text"
        required
        placeholder="초기 비번 (4자 이상)"
        className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-[#00A0E5] focus:outline-none"
      />
      <select
        name="role"
        defaultValue="operator"
        title={ASSIGNABLE_ROLES.map((r) => `${r.label}: ${r.hint}`).join("\n")}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-[#00A0E5] focus:outline-none"
      >
        {ASSIGNABLE_ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[#00A0E5] px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#0090d0] disabled:opacity-50"
      >
        {pending ? "추가 중…" : "추가"}
      </button>
      {error && (
        <p className="md:col-span-5 text-sm text-red-600">{error}</p>
      )}
    </form>
  );
}
