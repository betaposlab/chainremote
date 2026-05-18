"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { importPeer } from "@/lib/actions/customers";
import type { DiscoveredPeer } from "@/lib/peer-discovery";

export function DiscoveredPeerBanner({ peers }: { peers: DiscoveredPeer[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!peers.length) return null;

  const onAdd = (p: DiscoveredPeer) => {
    setBusyId(p.remoteId);
    start(async () => {
      await importPeer({
        remoteId: p.remoteId,
        hostname: p.hostname,
        username: p.username,
        platform: p.platform,
      });
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
            Mac에서 한 번이라도 원격 접속한 PC 중 아직 거래처로 등록 안 된 ID들이에요.
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
                {p.hostname && (
                  <span className="text-slate-700">{p.hostname}</span>
                )}
                {p.username && (
                  <span className="text-slate-400 text-xs">@{p.username}</span>
                )}
                {p.platform && (
                  <span className="text-slate-400 text-xs">· {p.platform}</span>
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
