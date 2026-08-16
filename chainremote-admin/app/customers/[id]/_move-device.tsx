"use client";

// 기기 이관 — 이 거래처가 쓰던 포스를 **다른 가맹점**으로 넘길 때.
//
// 왜 "상호만 바꾸기"로는 부족한가(2026-08-16 Chang):
//   폐업한 매장에서 포스를 수거해 새 가맹점에 넣는 건 이 업계에서 흔하다. 이때 거래처
//   이름만 고치면 **두 매장의 지원 이력이 한 줄로 섞인다** — 나중에 "이 매장 예전에 뭐
//   했었지"를 볼 수 없게 된다. 그래서 기기만 새 거래처로 떼어 옮기고, 옛 매장 행과 그
//   이력은 그대로 남긴다.
//
//   포맷하고 새로 설치하는 경우엔 설치 중 상호를 다시 받아 서버가 알아서 알림을 띄우므로
//   이 버튼이 필요 없다. 이건 **ChainRemote 를 안 지우고 포스 앱만 갈아끼운** 경우용이다.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveDeviceToNewCustomerAction } from "@/lib/actions/alerts";

export function MoveDeviceCard({
  customerId,
  customerName,
  remoteId,
}: {
  customerId: string;
  customerName: string;
  remoteId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!remoteId) return null;

  function submit() {
    setErr(null);
    start(async () => {
      const r = await moveDeviceToNewCustomerAction(customerId, name);
      if (!r.ok) {
        setErr(r.reason ?? "옮기지 못했습니다");
        return;
      }
      router.push("/customers");
      router.refresh();
    });
  }

  return (
    <div className="mt-6 rounded-xl border border-[#566999] bg-white/[0.02] p-5">
      <h2 className="text-sm font-semibold text-[#eef1f7]">기기 이관 (다른 가맹점으로 재사용)</h2>
      <p className="mt-1 text-xs text-[#9aa3ba]">
        이 거래처가 쓰던 포스를 다른 매장에 넘길 때 씁니다. 기기(ID {remoteId})만 새 거래처로
        옮기고, <b className="text-[#cbd1e0]">“{customerName}”의 지원 이력은 그대로 남습니다</b>.
        재설치할 필요 없이 바로 이어집니다.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn btn-ghost mt-3 text-xs"
        >
          기기를 새 거래처로 옮기기
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="block text-xs text-[#ccd2e3] mb-1">새 가맹점 상호</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 낭성정육 2호점"
              className="input"
              autoComplete="off"
            />
          </label>
          {err && <p className="text-xs text-[#ff9a9e]">{err}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || !name.trim()}
              onClick={() => {
                if (
                  !confirm(
                    `기기(${remoteId})를 “${name.trim()}” 으로 옮깁니다.\n\n` +
                      `“${customerName}” 은 거래처 목록에 남고 지난 지원 이력도 보존됩니다. ` +
                      `다만 연결된 기기가 없어져 원격은 안 됩니다.`,
                  )
                )
                  return;
                submit();
              }}
              className="btn btn-primary text-xs"
            >
              {pending ? "옮기는 중…" : "옮기기"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setErr(null);
              }}
              className="btn btn-ghost text-xs"
              disabled={pending}
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
