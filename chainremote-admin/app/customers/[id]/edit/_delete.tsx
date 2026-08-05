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
        // 즐겨찾기까지 지운다는 걸 명시한다 — 조용히 없애지 않는다(마이그019 가 경계했던
        // "직원 즐겨찾기 조용한 손실"을, 동작 대신 고지로 해결).
        if (
          !confirm(
            `"${name}" 거래처를 삭제할까요?\n\n` +
              `· 관련 지원기록도 같이 삭제됩니다.\n` +
              `· 이 기기를 즐겨찾기한 직원들의 즐겨찾기에서도 빠집니다.\n` +
              `  (안 그러면 '신규 거래처 후보'로 다시 올라옵니다.)`,
          )
        )
          return;
        start(async () => {
          await deleteCustomer(id);
          router.push("/customers");
        });
      }}
      className="rounded-lg border border-[#ff6b6f]/30 text-[#ff9a9e] hover:bg-[#ff5a5f]/10 px-3 py-1.5 text-sm disabled:opacity-50"
    >
      {pending ? "삭제 중..." : "삭제"}
    </button>
  );
}
