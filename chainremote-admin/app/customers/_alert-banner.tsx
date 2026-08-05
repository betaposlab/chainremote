"use client";

// 거래처 알림 배너 — enroll "상호 = 교체 키" 매트릭스가 자동 처리 못 한 애매한 경우를
// 마스터가 처리한다. 액션 서버측 owner 게이트와 별개로, 비마스터에겐 버튼을 숨긴다.

import { useState, useTransition } from "react";
import {
  moveFromAlertAction,
  renameFromAlertAction,
  resolveAlertAction,
} from "@/lib/actions/alerts";

export type AlertItem = {
  id: string;
  type: string;
  customerName: string | null;
  detail: {
    remoteId?: string;
    currentName?: string;
    newName?: string;
    name?: string;
    reason?: string;
  };
};

export function AlertBanner({ items, isOwner }: { items: AlertItem[]; isOwner: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (items.length === 0) return null;

  const run = (fn: (id: string) => Promise<boolean>, id: string) =>
    start(async () => {
      setErr(null);
      const ok = await fn(id).catch(() => false);
      if (!ok) setErr("처리 실패 — 상태가 바뀌었을 수 있습니다. 새로고침 후 다시 시도하세요.");
    });

  const btn =
    "rounded-md border border-amber-500/30 bg-transparent hover:bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200 disabled:opacity-50";

  return (
    <div className="mb-4 banner banner-warn">
      <div className="font-semibold mb-1">
        🔔 확인이 필요한 설치 이벤트 {items.length}건
      </div>
      {err && <div className="mb-2 text-xs text-[#ffb3b6]">{err}</div>}
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2">
            {a.type === "reinstalled_new_name" ? (
              <>
                <span>
                  <span className="font-medium">“{a.customerName ?? a.detail.currentName}”</span>
                  {" "}기기(ID {a.detail.remoteId})가 새 상호{" "}
                  <span className="font-medium">“{a.detail.newName}”</span> 로 설치됐습니다
                  {a.detail.reason ? ` (${a.detail.reason})` : ""}.
                </span>
                {isOwner && (
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(moveFromAlertAction, a.id)}
                      className={btn}
                      title="새 상호로 거래처를 새로 만들고 기기를 옮깁니다 (기존 거래처·이력 보존)"
                    >
                      새 거래처로 이동
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(renameFromAlertAction, a.id)}
                      className={btn}
                      title="기존 거래처의 상호를 새 이름으로 바꿉니다 (개명 의도였던 경우)"
                    >
                      상호만 변경
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(resolveAlertAction, a.id)}
                      className={btn}
                    >
                      무시
                    </button>
                  </span>
                )}
              </>
            ) : a.type === "same_name_new_device" ? (
              <>
                <span>
                  동일 상호 <span className="font-medium">“{a.detail.name}”</span> 거래처가 이미
                  있는데 새 기기(ID {a.detail.remoteId})로 또 등록됐습니다 — 한 매장 포스 2대(메인+오더)면
                  정상입니다.
                </span>
                {isOwner && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(resolveAlertAction, a.id)}
                    className={btn}
                  >
                    확인
                  </button>
                )}
              </>
            ) : (
              <>
                <span>
                  {a.customerName ?? ""} — {a.type}
                </span>
                {isOwner && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(resolveAlertAction, a.id)}
                    className={btn}
                  >
                    확인
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
