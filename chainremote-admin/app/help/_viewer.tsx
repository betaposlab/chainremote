"use client";

// 매뉴얼 PDF 뷰어.
//
// PC 는 브라우저 내장 PDF 뷰어를 iframe 으로 띄운다. 별도 라이브러리(pdf.js 등)를 붙이지
//   않는다 — 번들이 몇 백 KB 늘고, 브라우저가 이미 더 잘 하는 일이다.
//
// ★모바일은 iframe 을 쓰지 않는다. iOS 사파리는 iframe 안의 PDF 를 아예 안 그리고,
//   안드로이드 크롬은 A4 한 장을 통째로 축소해 글자를 못 읽게 만든다. 매장에서 폰으로
//   보는 경우가 실제로 많으므로, 좁은 화면에서는 **새 탭 / 내려받기 버튼 두 개**만 준다.
//   판단 기준은 화면 폭이다(터치 여부가 아니라) — 아이패드 가로처럼 넓으면 뷰어가 쓸 만하다.

import { useEffect, useState } from "react";

export function ManualViewer({ src, title }: { src: string; title: string }) {
  // null = 아직 모름(서버 렌더 시점). 첫 페인트에 둘 중 하나를 잘못 그리면 화면이 튄다.
  const [wide, setWide] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  if (wide === null) {
    return (
      <div className="panel-card flex h-[60vh] items-center justify-center text-sm text-[#cbd1e0]">
        매뉴얼을 여는 중…
      </div>
    );
  }

  if (!wide) {
    return (
      <div className="panel-card p-5 text-center">
        <div className="text-sm leading-relaxed text-[#cbd1e0]">
          휴대폰에서는 PDF 를 앱으로 여는 편이 훨씬 잘 보입니다.
          <br />
          아래 버튼을 눌러 주세요.
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
          >
            📄 새 탭에서 보기
          </a>
          <a href={`${src}?dl=1`} className="btn btn-ghost">
            ⬇ 내려받기
          </a>
        </div>
      </div>
    );
  }

  return (
    <iframe
      src={src}
      title={title}
      className="h-[78vh] w-full rounded-lg border border-[#566999] bg-[#1b2440]"
    />
  );
}
