"use client";

// 지원기록 조회 줄 — 검색어·기간·거래처.
//
// 왜 클라이언트 컴포넌트인가(2026-08-15 Chang 지적 셋):
//   ① "낭" 만 쳐도 바로 걸러지길 원한다. 서버 폼 제출은 엔터를 눌러야 돌아간다.
//   ② [전체 보기] 를 눌러도 입력칸에 검색어가 남아 있었다. Link 는 클라이언트 이동이라
//      React 가 input 을 재사용하는데, defaultValue 는 처음 붙을 때만 먹는다.
//      → 주소의 q 를 진실 원천으로 두고 상태를 따라가게 한다.
//   ③ 기간·거래처도 고르는 즉시 반영한다. 고르고 또 버튼을 누르는 건 한 동작이 두 번이다.
//
// ★입력칸을 key 로 remount 시켜 ②를 고치는 방법도 있지만, 그러면 글자를 칠 때마다
//   포커스가 날아간다. 그래서 controlled + 주소 동기화로 간다.

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const PERIOD_OPTIONS = [
  { value: "thisMonth", label: "이번 달" },
  { value: "week", label: "최근 7일" },
  { value: "month", label: "최근 30일" },
  { value: "all", label: "전체" },
] as const;

/** 글자를 칠 때마다 서버를 두들기지 않도록 잠깐 기다린다. 사람이 한 글자 더 칠 여유. */
const DEBOUNCE_MS = 250;

export function SessionFilterBar({
  customers,
}: {
  customers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const urlQ = sp.get("q") ?? "";
  const urlPeriod = sp.get("period") ?? "month";
  const urlCustomer = sp.get("customerId") ?? "";

  const [text, setText] = useState(urlQ);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 주소가 밖에서 바뀌면(전체 보기·뒤로가기) 입력칸도 따라간다.
  //   내가 친 글자로 주소가 바뀐 경우엔 값이 같아 아무 일도 안 일어난다 → 포커스 유지.
  useEffect(() => {
    setText(urlQ);
  }, [urlQ]);

  function apply(next: { q?: string; period?: string; customerId?: string }) {
    const p = new URLSearchParams();
    const q = next.q ?? urlQ;
    const period = next.period ?? urlPeriod;
    const customerId = next.customerId ?? urlCustomer;
    if (q.trim()) p.set("q", q.trim());
    if (period && period !== "month") p.set("period", period);
    if (customerId) p.set("customerId", customerId);
    const qs = p.toString();
    // replace — 글자마다 뒤로가기 기록이 쌓이면 뒤로 가기가 못 쓰게 된다.
    // scroll:false — 결과가 바뀔 때마다 맨 위로 튀면 읽던 자리를 잃는다.
    router.replace(qs ? `/sessions?${qs}` : "/sessions", { scroll: false });
  }

  function onType(v: string) {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ q: v }), DEBOUNCE_MS);
  }

  // 컴포넌트가 사라질 때 예약된 조회를 취소한다.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const dirty = Boolean(urlQ || urlCustomer || sp.get("period"));

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <div className="relative">
        <input
          type="text"
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            // 엔터로도 즉시 조회 — 기다리지 않고 바로 반영되길 원하는 사람이 있다.
            if (e.key === "Enter") {
              if (timer.current) clearTimeout(timer.current);
              apply({ q: text });
            }
            if (e.key === "Escape") {
              setText("");
              if (timer.current) clearTimeout(timer.current);
              apply({ q: "" });
            }
          }}
          placeholder="내용 · 거래처 · 응대자 검색"
          aria-label="지원기록 검색"
          className="w-60 rounded-md border border-[#566999] bg-transparent px-2.5 py-1.5 pr-7 placeholder:text-[#8b93ab]"
        />
        {text && (
          <button
            type="button"
            onClick={() => {
              setText("");
              if (timer.current) clearTimeout(timer.current);
              apply({ q: "" });
            }}
            aria-label="검색어 지우기"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-[#9aa3ba] hover:text-white"
          >
            ×
          </button>
        )}
      </div>

      <select
        value={urlPeriod}
        onChange={(e) => apply({ period: e.target.value })}
        aria-label="기간"
        className="rounded-md border border-[#566999] px-2 py-1.5"
      >
        {PERIOD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={urlCustomer}
        onChange={(e) => apply({ customerId: e.target.value })}
        aria-label="거래처"
        className="rounded-md border border-[#566999] px-2 py-1.5"
      >
        <option value="">전체 거래처</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {/*
        조회 버튼 — 즉시 반영이라 없어도 결과는 같지만, 버튼이 없으면 "다 쳤는데 왜 아무
        일도 안 일어나지" 하고 기다리는 사람이 생긴다. 누르면 대기 시간을 건너뛰고 바로
        적용하니 장식이 아니다(엔터와 같은 동작).
      */}
      <button
        type="button"
        onClick={() => {
          if (timer.current) clearTimeout(timer.current);
          apply({ q: text });
        }}
        className="rounded-md bg-[#2f4b8f] px-3 py-1.5 font-medium text-white hover:bg-[#3a5aa8]"
      >
        조회
      </button>

      {dirty && (
        <button
          type="button"
          onClick={() => router.replace("/sessions", { scroll: false })}
          title="검색 조건만 지웁니다. 기록은 삭제되지 않습니다."
          className="text-xs text-[#ccd2e3] underline hover:text-white"
        >
          전체 보기
        </button>
      )}
    </div>
  );
}
