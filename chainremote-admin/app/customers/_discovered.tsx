"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { importPeer } from "@/lib/actions/customers";
import type { OrphanFavorite } from "@/lib/data/favorites";

export function DiscoveredPeerBanner({ peers }: { peers: OrphanFavorite[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!peers.length) return null;

  const onAdd = (p: OrphanFavorite) => {
    setBusyId(p.remoteId);
    start(async () => {
      await importPeer({ remoteId: p.remoteId });
      setBusyId(null);
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
            직원이 즐겨찾기했지만 아직 거래처로 등록 안 된 ID들이에요.
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
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                  {p.remoteId}
                </span>
                {p.favoritedBy.length > 0 && (
                  <span className="text-slate-400 text-xs">
                    즐겨찾기: {p.favoritedBy.join(", ")}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onAdd(p)}
              disabled={pending}
              className="rounded-md bg-[#00A0E5] hover:bg-[#0090d0] disabled:opacity-50 text-white px-3 py-1 text-xs font-medium"
            >
              {busyId === p.remoteId ? "추가 중..." : "+ 추가"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
