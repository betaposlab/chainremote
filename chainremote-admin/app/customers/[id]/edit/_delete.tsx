"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCustomer } from "@/lib/actions/customers";

export function DeleteButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`"${name}" 거래처를 삭제할까요?\n관련 지원기록도 같이 삭제됩니다.`)) return;
        start(async () => {
          await deleteCustomer(id);
          router.push("/customers");
        });
      }}
      className="rounded-lg border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1.5 text-sm disabled:opacity-50"
    >
      {pending ? "삭제 중..." : "삭제"}
    </button>
  );
}
