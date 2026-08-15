"use client";

// [기록 추가] — 원격 없이 처리한 A/S(전화) 나 실수로 지워 버린 기록을 손으로 남긴다.
//   담당은 로그인한 본인. 원격 세션과 구분되게 "수동" 표식이 붙는다(마이그045).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createManualSession } from "@/lib/actions/sessions";
import { RecordFields } from "./_record-fields";
import { CustomerPicker } from "./_customer-picker";
import type { SearchableCustomer } from "@/lib/customer-search";

/** datetime-local 기본값 — 브라우저 로컬 시각을 "YYYY-MM-DDTHH:MM" 로. */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AddRecordButton({ customers }: { customers: SearchableCustomer[] }) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const now = new Date();
  const halfHourAgo = new Date(now.getTime() - 30 * 60_000);

  function submit(fd: FormData) {
    setError(null);
    // datetime-local 은 시간대 없는 문자열이라 여기서 ISO 로 바꿔 보낸다(서버는 UTC 로 받는다).
    for (const k of ["startedAt", "endedAt"] as const) {
      const v = String(fd.get(k) ?? "");
      if (v) fd.set(k, new Date(v).toISOString());
    }
    start(async () => {
      const r = await createManualSession(fd);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setCustomerId("");
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost text-sm">
        + 기록 추가
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <form
            action={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-xl border border-[#566999] bg-[#3D4E7A] p-5 shadow-2xl space-y-4"
          >
            <div>
              <h2 className="text-lg font-semibold text-white">지원 기록 추가</h2>
              <p className="mt-1 text-xs text-[#ccd2e3]">
                원격 없이 처리한 A/S(전화 안내)나 실수로 지운 기록을 손으로 남깁니다.
                원격 세션과 구분되도록 <b className="text-[#C3D3FF]">수동</b> 표식이 붙습니다.
              </p>
            </div>

            <div>
              <span className="block text-xs text-[#ccd2e3] mb-1">거래처</span>
              {/* 2,000곳이라도 치면서 좁힌다 — 상호·원격 ID·초성. */}
              <CustomerPicker
                customers={customers}
                value={customerId}
                onChange={setCustomerId}
                name="customerId"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-[#ccd2e3] mb-1">시작</span>
                <input
                  type="datetime-local"
                  name="startedAt"
                  required
                  defaultValue={localInput(halfHourAgo)}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-[#ccd2e3] mb-1">종료</span>
                <input
                  type="datetime-local"
                  name="endedAt"
                  required
                  defaultValue={localInput(now)}
                  className="input"
                />
              </label>
            </div>

            <RecordFields descriptionRequired />

            {error && <p className="text-sm text-[#ff9a9e]">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn btn-ghost"
                disabled={pending}
              >
                취소
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? "저장 중…" : "기록 저장"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
