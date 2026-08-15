"use client";

// 거래처 고르기 — 치면서 좁히는 콤보박스. 2,000곳짜리 <select> 는 못 쓴다(2026-08-15 Chang).
//   상호·원격 ID·초성("ㄴㅅ" → 낭성) 으로 걸러진다. 규칙은 lib/customer-search.ts.
//
// ★왜 <select> 대신 직접 만들었나: 브라우저 기본 select 는 목록 안 검색이 없고(첫 글자
//   점프만 된다), datalist 는 다크 테마에서 OS 마다 제각각이라 화면이 갈린다.

import { useEffect, useMemo, useRef, useState } from "react";
import { filterCustomers, type SearchableCustomer } from "@/lib/customer-search";

/** 한 번에 그리는 최대 줄 수. 2,000곳을 다 그리면 타자마다 화면이 버벅인다. */
const MAX_ROWS = 60;

export function CustomerPicker({
  customers,
  value,
  onChange,
  emptyLabel,
  placeholder = "상호·ID·초성으로 검색",
  name,
  required,
}: {
  customers: SearchableCustomer[];
  value: string;
  onChange: (id: string) => void;
  /** 있으면 "전체 거래처" 같은 비움 선택지를 맨 위에 둔다(조회용). 없으면 필수 선택(입력용). */
  emptyLabel?: string;
  placeholder?: string;
  /** 폼 제출용 hidden input 이름. */
  name?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = customers.find((c) => c.id === value) ?? null;
  const hits = useMemo(() => filterCustomers(customers, q), [customers, q]);
  const shown = hits.slice(0, MAX_ROWS);

  // 바깥을 누르면 닫는다. 열려 있을 때만 리스너를 단다.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQ("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const n = shown.length + (emptyLabel ? 1 : 0);
      if (!n) return;
      setCursor((c) => (e.key === "ArrowDown" ? (c + 1) % n : (c - 1 + n) % n));
      return;
    }
    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      if (emptyLabel) {
        if (cursor === 0) return pick("");
        const c = shown[cursor - 1];
        if (c) pick(c.id);
        return;
      }
      const c = shown[cursor];
      if (c) pick(c.id);
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setQ("");
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      {name && <input type="hidden" name={name} value={value} />}
      {/* required 를 hidden 에 걸면 브라우저가 "보이지 않는 필드" 라며 제출을 막고 아무 말도
          안 한다. 그래서 검증은 서버(createManualSession)가 하고 여기선 표시만 한다. */}

      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setCursor(0);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className={`input text-left flex items-center justify-between gap-2 ${
          !selected && required ? "text-[#8b93ab]" : ""
        }`}
      >
        <span className="truncate">
          {selected ? selected.name : emptyLabel ?? "거래처 선택"}
        </span>
        <span className="text-[#8b93ab] text-xs shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-[60] mt-1 w-full min-w-[16rem] rounded-lg border border-[#566999] bg-[#2b364f] shadow-2xl">
          <div className="p-2 border-b border-[#51638F]">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className="input !py-1.5 text-sm"
              aria-label="거래처 검색"
            />
          </div>

          <ul className="max-h-72 overflow-y-auto py-1 text-sm">
            {emptyLabel && (
              <li>
                <button
                  type="button"
                  onClick={() => pick("")}
                  onMouseEnter={() => setCursor(0)}
                  className={`w-full text-left px-3 py-1.5 ${
                    cursor === 0 ? "bg-[#4C7DFF]/25 text-white" : "text-[#cbd1e0]"
                  }`}
                >
                  {emptyLabel}
                </button>
              </li>
            )}
            {shown.map((c, i) => {
              const idx = emptyLabel ? i + 1 : i;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pick(c.id)}
                    onMouseEnter={() => setCursor(idx)}
                    className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-3 ${
                      cursor === idx ? "bg-[#4C7DFF]/25 text-white" : "text-[#eef1f7]"
                    }`}
                  >
                    <span className="truncate">{c.name}</span>
                    {c.remoteId && (
                      <span className="shrink-0 text-[11px] tabular-nums text-[#9aa3ba]">
                        {c.remoteId}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="px-3 py-3 text-[#9aa3ba]">일치하는 거래처가 없습니다.</li>
            )}
          </ul>

          {/* 잘렸다는 사실을 말한다 — 말 안 하면 "이게 전부"로 읽힌다. */}
          {hits.length > shown.length && (
            <div className="border-t border-[#51638F] px-3 py-1.5 text-[11px] text-[#9aa3ba]">
              {hits.length}곳 중 {shown.length}곳 — 더 치면 좁혀집니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
