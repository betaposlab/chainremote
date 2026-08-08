// 도움말 문서용 조각들.
//
// MDX 를 붙이지 않은 이유: 문서가 네댓 편이고 전부 우리가 쓴다. 빌드 파이프라인을 하나 더
//   들이는 값보다, 화면과 같은 컴포넌트·색을 그대로 쓰는 값이 크다. 문서가 열 편을 넘고
//   외부 기고가 생기면 그때 옮기면 된다.

import Link from "next/link";

export function DocHeader({
  title,
  lead,
  updated,
}: {
  title: string;
  lead: string;
  updated: string;
}) {
  return (
    <header className="mb-8">
      <Link href="/help" className="text-xs text-[#c3d3ff] hover:underline">
        ← 도움말 목차
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[#cbd1e0]">{lead}</p>
      <p className="mt-2 text-xs text-[#ccd2e3]">최종 수정 {updated}</p>
    </header>
  );
}

export function Section({
  n,
  title,
  children,
}: {
  n?: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
        {n !== undefined && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4c7dff] text-xs font-bold text-white">
            {n}
          </span>
        )}
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-[#eef1f7]">{children}</div>
    </section>
  );
}

/** 순서가 있는 조작 절차. 번호를 눈으로 세기 쉽게 큼직하게 둔다. */
export function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#566999] text-[0.7rem] text-[#c3d3ff]">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1">{it}</span>
        </li>
      ))}
    </ol>
  );
}

/** 놓치면 사고가 나는 것. 남발하면 아무도 안 읽으므로 문서당 한둘로 아낀다. */
export function Warn({ children }: { children: React.ReactNode }) {
  return <div className="banner banner-warn">{children}</div>;
}

export function Danger({ children }: { children: React.ReactNode }) {
  return <div className="banner banner-danger">{children}</div>;
}

export function Note({ children }: { children: React.ReactNode }) {
  return <div className="banner banner-accent">{children}</div>;
}

/** 화면에서 눌러야 할 것. 본문에서 즉시 구분되게. */
export function UI({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-[#566999] bg-[#3b5291]/40 px-1.5 py-0.5 text-[0.8em] text-white">
      {children}
    </span>
  );
}
