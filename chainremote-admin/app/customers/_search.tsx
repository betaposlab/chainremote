"use client";

import { useEffect, useState } from "react";

// 거래처 표 즉시 검색. 서버 렌더된 표는 그대로 두고, 각 행의 data-search 속성(상호·담당·
// 연락처·ID·메모를 소문자로 합친 것)과 대조해 클라이언트에서 즉시 표시/숨김한다.
// 25~수백 행 내부 패널이라 DOM 필터로 충분하고, 서버 왕복/리로드가 없어 입력이 매끄럽다.
export function CustomerSearch() {
  const [q, setQ] = useState("");

  useEffect(() => {
    const term = q.trim().toLowerCase();
    const rows =
      document.querySelectorAll<HTMLTableRowElement>("tr[data-search]");
    let shown = 0;
    rows.forEach((r) => {
      const hay = r.getAttribute("data-search") ?? "";
      const match = term === "" || hay.includes(term);
      r.style.display = match ? "" : "none";
      if (match) shown++;
    });
    const empty = document.getElementById("cust-search-empty");
    if (empty) {
      (empty as HTMLElement).style.display =
        term !== "" && shown === 0 ? "" : "none";
    }
  }, [q]);

  return (
    <div className="relative">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#e4e7f0]"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="상호 · 담당자 · 연락처 · ID 검색"
        className="w-64 rounded-lg border border-[#7687b2] bg-[#4e639c] pl-9 pr-3 py-2 text-sm placeholder:text-[#e4e7f0] focus:outline-none focus:ring-2 focus:ring-[#4c7dff]/30 focus:border-[#4c7dff]"
      />
    </div>
  );
}
