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
        className="rounded-md input"
      />
      <input
        name="displayName"
        type="text"
        required
        placeholder="이름"
        className="rounded-md input"
      />
      <input
        name="password"
        type="text"
        required
        placeholder="초기 비번 (4자 이상)"
        className="rounded-md input"
      />
      <select
        name="role"
        defaultValue="operator"
        title={ASSIGNABLE_ROLES.map((r) => `${r.label}: ${r.hint}`).join("\n")}
        className="rounded-md input"
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
        className="btn btn-primary w-full"
      >
        {pending ? "추가 중…" : "추가"}
      </button>
      {error && (
        <p className="md:col-span-5 text-sm text-[#ff9a9e]">{error}</p>
      )}
    </form>
  );
}
