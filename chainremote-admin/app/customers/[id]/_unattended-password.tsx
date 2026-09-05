"use client";

// 무인접속 비밀번호 — 거래처 PC 앞에 아무도 없어도 원격을 시작할 수 있게 하는 값.
//
// # 왜 이 칸이 생겼나 (2026-09-05)
//
// 무인접속을 켠 대리점의 설치본은 "영구 비밀번호가 있으면 수락 카드 없이 통과"한다.
// 그런데 그 비밀번호를 정하는 길이 **거래처 PC 앞에서 에이전트 창을 열고 손으로 넣는 것**
// 하나뿐이었다. 사람이 없어서 무인접속을 켜는 건데, 켜려면 사람이 가야 했다.
// 달인식자재가 그 모순에 그대로 걸렸다 — 사무실은 비었고 PC 는 켜져 있는데 아무도
// 열어 줄 수 없었다. 그래서 여기서 정하고 하트비트가 실어 나른다.
//
// # 왜 값을 가리지 않고 그냥 보여주나
//
// 이 값은 본사 앱이 접속할 때 **사람이 받아 적어 넣는** 값이다. 가려 놓으면 매번 [보기]를
// 누르게 되고, 그 클릭은 아무도 지켜 주지 않는다(이미 로그인한 자기 대리점 화면이다).
// 지켜야 할 건 "누가 언제 이걸 바꿨나" 쪽이고 그건 감사 기록이 맡는다.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUnattendedPasswordAction } from "@/lib/actions/customers";

export function UnattendedPasswordCard({
  customerId,
  customerName,
  remoteId,
  current,
}: {
  customerId: string;
  customerName: string;
  remoteId: string | null;
  current: string | null;
}) {
  const [value, setValue] = useState(current ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  // 기기가 안 붙은 거래처엔 보낼 곳이 없다. 칸을 보여 주면 "저장했는데 왜 안 되지"가 된다.
  if (!remoteId) return null;

  const isSet = !!current;
  const changed = value.trim() !== (current ?? "");

  function save(next: string) {
    setErr(null);
    setDone(null);
    start(async () => {
      const r = await setUnattendedPasswordAction(customerId, next);
      if (!r.ok) {
        setErr(r.reason ?? "저장하지 못했습니다");
        return;
      }
      setValue(next);
      setDone(
        next === ""
          ? "지웠습니다. 다음 보고(최대 10분) 뒤부터 다시 수락 카드가 뜹니다."
          : "저장했습니다. 다음 보고(최대 10분) 뒤부터 적용됩니다.",
      );
      router.refresh();
    });
  }

  return (
    <div className="mt-6 rounded-xl border border-[#566999] bg-white/[0.02] p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-[#eef1f7]">무인접속 비밀번호</h2>
        <span
          className={
            isSet
              ? "rounded px-1.5 py-0.5 text-[11px] font-semibold text-[#3DDC84] bg-[#3DDC84]/12"
              : "rounded px-1.5 py-0.5 text-[11px] font-semibold text-[#ccd2e3] bg-white/[0.06]"
          }
        >
          {isSet ? "설정됨 — 수락 없이 접속" : "없음 — 매번 수락 카드"}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-[#9aa3ba]">
        정해 두면 <b className="text-[#cbd1e0]">“{customerName}”</b> 은 본사 앱에서 이
        비밀번호로 바로 열립니다 — 거래처 PC 앞에 아무도 없어도 됩니다. 비우면 다시
        매 세션 수락 카드를 누르게 됩니다.
        <br />
        거래처 PC({remoteId})가 켜져 있어야 전달되고, 반영까지 최대 10분 걸립니다.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setDone(null);
          }}
          placeholder="6자 이상, 공백 없이"
          autoComplete="off"
          spellCheck={false}
          className="input w-56 font-mono"
        />
        <button
          type="button"
          disabled={pending || !changed || !value.trim()}
          onClick={() => save(value.trim())}
          className="btn btn-primary text-xs"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
        {isSet && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => navigator.clipboard?.writeText(current)}
              className="btn btn-ghost text-xs"
            >
              복사
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (
                  !confirm(
                    `“${customerName}” 의 무인접속 비밀번호를 지웁니다.\n\n` +
                      `지운 뒤에는 원격할 때마다 거래처가 수락 카드를 눌러야 합니다.`,
                  )
                )
                  return;
                save("");
              }}
              className="btn btn-ghost text-xs text-[#ff9a9e]"
            >
              지우기
            </button>
          </>
        )}
      </div>

      {err && <p className="mt-2 text-xs text-[#ff9a9e]">{err}</p>}
      {done && <p className="mt-2 text-xs text-[#3DDC84]">{done}</p>}
    </div>
  );
}
