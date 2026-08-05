"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { importPeer, dismissCandidate } from "@/lib/actions/customers";
import type { OrphanFavorite } from "@/lib/data/favorites";
import { formatRemoteId } from "@/lib/id-formatter";

export function DiscoveredPeerBanner({ peers }: { peers: OrphanFavorite[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  // "추가" 클릭 시 상호 입력 다이얼로그를 띄울 대상 peer 와 입력 초안.
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

  // 후보 삭제 — orphan 즐겨찾기를 지워 배너에서 치운다(테스트 머신 등). 확인 후 실행.
  const onDismiss = (p: OrphanFavorite) => {
    if (
      !confirm(
        `'${p.alias || p.hostname || p.remoteId}' 후보를 목록에서 삭제할까요?\n(이 머신의 미등록 즐겨찾기가 제거됩니다. 테스트 장비 등 거래처로 안 쓸 때.)`,
      )
    )
      return;
    setBusyId(p.remoteId);
    start(async () => {
      await dismissCandidate(p.remoteId);
      setBusyId(null);
      router.refresh();
    });
  };

  return (
    <div className="mb-5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm text-amber-200">
            ✨ 신규 거래처 후보 {peers.length}곳 발견
          </h3>
          <p className="text-xs text-amber-200 mt-0.5">
            직원이 즐겨찾기했지만 아직 거래처로 등록 안 된 머신이에요.
          </p>
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {peers.map((p) => (
          <li
            key={p.remoteId}
            className="flex items-center justify-between rounded-lg bg-[#1e2740] border border-amber-500/25 px-3 py-2 text-sm"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-white truncate">
                {p.alias || p.hostname || "이름 미상"}
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="font-mono text-xs bg-white/[0.06] px-1.5 py-0.5 rounded">
                  {formatRemoteId(p.remoteId)}
                </span>
                {p.favoritedBy.length > 0 && (
                  <span className="text-[#838aa4] text-xs">
                    즐겨찾기: {p.favoritedBy.join(", ")}
                  </span>
                )}
                <span className="text-[#838aa4] text-xs">
                  {new Date(p.favoritedAt).toLocaleString("ko-KR")}
                </span>
              </div>
            </div>
            <div className="shrink-0 ml-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => openDialog(p)}
                disabled={pending}
                className="btn btn-primary btn-sm"
              >
                {busyId === p.remoteId ? "추가 중..." : "+ 추가"}
              </button>
              <button
                type="button"
                onClick={() => onDismiss(p)}
                disabled={pending}
                title="후보 삭제 (미등록 즐겨찾기 제거)"
                className="btn btn-ghost btn-sm"
              >
                {busyId === p.remoteId ? "..." : "삭제"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {dialogPeer && (
        <div className="fixed inset-0 z-50 bg-[#02040a]/70 p-4 flex items-start justify-center overflow-y-auto">
          <div className="mt-24 w-full max-w-sm rounded-xl bg-[#1e2740] border border-[#3d4c71] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
            <header className="border-b border-[#2c3852] px-5 py-3">
              <h2 className="text-base font-semibold">거래처 등록</h2>
              <p className="text-xs text-[#9ba2b8] mt-0.5 font-mono">
                {formatRemoteId(dialogPeer.remoteId)}
                {dialogPeer.hostname ? ` · ${dialogPeer.hostname}` : ""}
              </p>
            </header>
            <div className="px-5 py-4">
              <label className="block text-xs font-medium text-[#d6d8de] mb-1">
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
                className="w-full rounded border border-[#3d4c71] px-2 py-1.5 text-sm"
              />
              <p className="text-xs text-[#838aa4] mt-1">
                비워두면 hostname/ID 로 임시 이름이 들어가요.
              </p>
            </div>
            <footer className="border-t border-[#2c3852] px-5 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDialog}
                disabled={pending}
                className="btn btn-ghost"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmAdd}
                disabled={pending}
                className="rounded btn btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
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
