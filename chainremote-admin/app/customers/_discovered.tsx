"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { importPeer } from "@/lib/actions/customers";
import type { OrphanFavorite } from "@/lib/data/favorites";

export function DiscoveredPeerBanner({ peers }: { peers: OrphanFavorite[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  // "추가" 클릭 시 상호 입력 다이얼로그를 띄울 대상 peer + 입력 초안.
  const [dialogPeer, setDialogPeer] = useState<OrphanFavorite | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  if (!peers.length) return null;

  const openDialog = (p: OrphanFavorite) => {
    setDialogPeer(p);
    setNameDraft(p.alias || p.hostname || "");
  };

  const closeDialog = () => {
    setDialogPeer(null);
    setNameDraft("");
  };

  const confirmAdd = () => {
    const p = dialogPeer;
    if (!p) return;
    setBusyId(p.remoteId);
    start(async () => {
      await importPeer({
        remoteId: p.remoteId,
        hostname: p.hostname ?? undefined,
        name: nameDraft.trim() || undefined,
      });
      setBusyId(null);
      closeDialog();
      router.refresh();
    });
  };

  return (
    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm text-amber-900">
            ✨ 신규 거래처 후보 {peers.length}곳 발견
          </h3>
          <p className="text-xs text-amber-800 mt-0.5">
            직원이 즐겨찾기했지만 아직 거래처로 등록 안 된 머신이에요.
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {peers.map((p) => (
          <li
            key={p.remoteId}
            className="flex items-center justify-between rounded-lg bg-white border border-amber-200 px-3 py-2 text-sm"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-slate-800 truncate">
                {p.alias || p.hostname || "이름 미상"}
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  {p.remoteId}
                </span>
                {p.favoritedBy.length > 0 && (
                  <span className="text-slate-400 text-xs">
                    즐겨찾기: {p.favoritedBy.join(", ")}
                  </span>
                )}
                <span className="text-slate-400 text-xs">
                  {new Date(p.favoritedAt).toLocaleString("ko-KR")}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openDialog(p)}
              disabled={pending}
              className="shrink-0 ml-2 rounded-md bg-[#00A0E5] hover:bg-[#0090d0] disabled:opacity-50 text-white px-3 py-1 text-xs font-medium"
            >
              {busyId === p.remoteId ? "추가 중..." : "+ 추가"}
            </button>
          </li>
        ))}
      </ul>

      {dialogPeer && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 p-4 flex items-start justify-center overflow-y-auto">
          <div className="mt-24 w-full max-w-sm rounded-xl bg-white shadow-2xl">
            <header className="border-b border-slate-200 px-5 py-3">
              <h2 className="text-base font-semibold">거래처 등록</h2>
              <p className="text-xs text-slate-500 mt-0.5 font-mono">
                {dialogPeer.remoteId}
                {dialogPeer.hostname ? ` · ${dialogPeer.hostname}` : ""}
              </p>
            </header>
            <div className="px-5 py-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                거래처 상호
              </label>
              <input
                type="text"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmAdd();
                }}
                placeholder="예: 삼성공판장"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
              <p className="text-xs text-slate-400 mt-1">
                비워두면 hostname/ID 로 임시 이름이 들어가요.
              </p>
            </div>
            <footer className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDialog}
                disabled={pending}
                className="rounded border border-slate-300 hover:bg-slate-50 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmAdd}
                disabled={pending}
                className="rounded bg-[#00A0E5] hover:bg-[#0090d0] text-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {pending ? "처리 중..." : "등록"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
