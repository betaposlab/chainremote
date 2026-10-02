"use client";
// 숫자판 — 담당자가 전화로 불러 주는 대리점 번호를 **마우스로** 누른다.
//
// 왜 숫자판인가(2026-10-01 Chang): 종전엔 고객이 RustDesk 창의 숫자 9자리와 영문 섞인
//   비밀번호 6자를 읽어 줘야 했다. 영어를 모르는 분에게는 자존심이 걸린 일이고, 작은
//   글자를 읽는 것도, 키보드로 치는 것도 어렵다. 여기서는 큰 숫자 버튼 세 번이면 끝난다.
// ★버튼은 크게, 글자는 숫자만. 키보드로도 되지만 안내는 "눌러 주세요" 하나로 통일한다.
// ★번호가 맞으면 대리점 상호를 보여 준다 — 담당자가 번호를 잘못 불러 줬을 때 여기서 드러난다.

import { useCallback, useEffect, useRef, useState } from "react";

type Phase =
  | { kind: "input" }
  | { kind: "checking" }
  | { kind: "ready"; name: string; code: string };

const MAX_LEN = 4;

export function SupportKeypad() {
  const [digits, setDigits] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "input" });
  const [error, setError] = useState<string | null>(null);
  // 같은 번호를 두 번 묻지 않게 — 3자리에서 틀렸다고 답 온 뒤 4번째를 누를 수 있다.
  const asked = useRef<Set<string>>(new Set());

  const check = useCallback(async (code: string) => {
    if (asked.current.has(code)) return;
    asked.current.add(code);
    setPhase({ kind: "checking" });
    try {
      const r = await fetch(`/api/quick-support/check?code=${code}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; name?: string };
      if (r.ok && j.ok && j.name) {
        setError(null);
        setPhase({ kind: "ready", name: j.name, code });
        // 받기 시작. 이름은 서버의 Content-Disposition 이 정한다.
        window.location.href = `/api/quick-support?code=${code}`;
        return;
      }
      setPhase({ kind: "input" });
      if (r.status === 429 || r.status >= 500) {
        // 서버가 못 답한 것을 "번호가 틀렸다"고 말하지 않는다 — 고객은 맞게 눌렀을 수 있다.
        asked.current.delete(code);
        setError("잠시 후 [지움] 을 누르고 다시 눌러 주세요.");
      } else {
        // 틀린 번호는 화면에 남겨 둔다 — 무엇을 눌렀는지 보여야 고칠 수 있다.
        // (4자리 번호의 앞 3자리일 수도 있으니 한 자리 더 누르는 것도 막지 않는다.)
        setError("번호가 맞지 않습니다. [지움] 을 누르고 다시 눌러 주세요.");
      }
    } catch {
      setPhase({ kind: "input" });
      asked.current.delete(code);
      setError("인터넷 연결을 확인하고 다시 눌러 주세요.");
    }
  }, []);

  const press = useCallback(
    (d: string) => {
      if (phase.kind !== "input" || digits.length >= MAX_LEN) return;
      const next = digits + d;
      setError(null);
      setDigits(next);
      if (next.length >= 3) void check(next);
    },
    [phase.kind, digits, check],
  );

  const erase = useCallback(() => {
    if (phase.kind !== "input") return;
    setError(null);
    setDigits(digits.slice(0, -1));
  }, [phase.kind, digits]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") erase();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, erase]);

  if (phase.kind === "ready") {
    return (
      <div className="text-center">
        <p className="text-sm text-[#b9bfd2]">원격지원</p>
        <h1 className="mt-1 text-2xl font-bold text-white">{phase.name}</h1>
        <ol className="mt-6 space-y-4 text-left text-base leading-relaxed text-[#eef1f7]">
          {/* ★"다 받아진 뒤" 를 꼭 말한다(2026-10-02 테스트1). 받는 중에 누르면 윈도우가 아직 덜 받은
              파일을 검사해 "게시자를 확인하지 못했습니다(서명 없음)" 경고를 한 번 더 띄운다 — 서명은
              파일 맨 끝에 붙어 있어서, 덜 받은 파일엔 서명이 없는 것으로 보인다. */}
          <li>
            <span className="mr-2 font-bold text-[#7CF2B0]">1</span>
            아래쪽 파일이 <b>다 받아지면</b> 눌러서 <b>실행</b>해 주세요. 확인 창이 뜨면 [실행].
          </li>
          {/* ★[설치하기] 를 누르면 RustDesk 가 서비스로 깔려 남는다 — 우리 에이전트를 설치할 일이다. */}
          <li>
            <span className="mr-2 font-bold text-[#7CF2B0]">2</span>
            <b>RustDesk</b> 창이 뜨면 그대로 두세요. 창 안의 <b>[설치하기]</b> 는 누르지 마세요.
          </li>
          <li>
            <span className="mr-2 font-bold text-[#7CF2B0]">3</span>
            잠시 뒤 작은 창이 뜨면 <b>수락</b> 을 눌러 주세요.
          </li>
        </ol>
        <a
          href={`/api/quick-support?code=${phase.code}`}
          className="mt-7 inline-block text-sm text-[#8fb3ff] underline"
        >
          파일이 안 받아졌으면 여기를 눌러 주세요
        </a>
      </div>
    );
  }

  const busy = phase.kind === "checking";
  return (
    <div>
      <h1 className="text-center text-xl font-bold text-white">원격지원 받기</h1>
      <p className="mt-2 text-center text-sm leading-relaxed text-[#d7dcea]">
        담당자가 불러 주는 <b className="text-white">번호</b>를 눌러 주세요.
      </p>

      <div
        aria-live="polite"
        // 테두리 색은 인라인으로 — 전역 CSS 가 border 색을 덮어 클래스로는 안 먹는다(로그인 버튼과 같은 사정).
        style={{ borderWidth: "2px", borderColor: "#7CF2B0" }}
        className="mx-auto mt-5 flex h-16 w-52 items-center justify-center rounded-lg bg-[#2b364f] text-4xl font-bold tracking-[0.4em] text-white"
      >
        {digits || <span className="text-2xl tracking-normal text-[#7f8aa8]">번호</span>}
      </div>
      <p className="mt-2 h-5 text-center text-sm text-[#ffb4b4]">{error ?? (busy ? "확인 중…" : "")}</p>

      <div className="mt-2 grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} label={d} onPress={() => press(d)} disabled={busy} />
        ))}
        <span />
        <Key label="0" onPress={() => press("0")} disabled={busy} />
        <button
          type="button"
          onClick={erase}
          disabled={busy || !digits}
          className="h-16 rounded-lg border border-[#566999] bg-[#33426a] text-base font-medium text-[#eef1f7] hover:bg-[#3b4c79] disabled:opacity-40"
        >
          지움
        </button>
      </div>

      <p className="mt-6 text-center text-xs text-[#b9bfd2]">
        번호를 모르시면{" "}
        <a href="/api/quick-support" className="text-[#8fb3ff] underline">
          번호 없이 받기
        </a>
      </p>
    </div>
  );
}

function Key({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className="h-16 rounded-lg border border-[#566999] bg-[#4a5d8f] text-3xl font-bold text-white hover:bg-[#5670ad] active:bg-[#1FA867] disabled:opacity-40"
    >
      {label}
    </button>
  );
}
