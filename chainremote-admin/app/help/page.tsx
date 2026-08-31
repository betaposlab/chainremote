// 도움말 목차.
//
// 문서는 전부 PDF 한 벌이 정본이다(이유는 lib/manuals.ts 주석). 문서를 늘리려면 여기가
//   아니라 그 표에 한 줄을 더하고 manuals/ 에 파일을 넣은 뒤 app/help/{slug}/page.tsx
//   를 한 장 복사한다 — 이 화면은 표를 그대로 그린다.

import type { Metadata } from "next";
import Link from "next/link";
import { requireLiveUser } from "@/lib/auth-guard";
import { MANUALS } from "@/lib/manuals";

export const metadata: Metadata = { title: "도움말 — ChainRemote 관리 패널" };

export default async function HelpIndexPage() {
  await requireLiveUser();

  return (
    <div className="px-4 py-5 md:px-8 md:py-6 max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">도움말</h1>
        <p className="mt-1 text-sm text-[#cbd1e0]">
          ChainRemote 를 설치하고 쓰는 방법입니다. 궁금한 게 여기 없으면{" "}
          <Link href="/feedback" className="text-[#c3d3ff] hover:underline">
            문의하기
          </Link>
          로 알려 주세요.
        </p>
      </header>

      <div className="space-y-2">
        {MANUALS.map((m) => (
          <Link
            key={m.slug}
            href={`/help/${m.slug}`}
            className="panel-card block p-4 transition-colors hover:bg-white/[0.04]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-white">{m.title}</span>
              <span className="chip chip-neutral">{m.version}</span>
            </div>
            <div className="mt-1 text-sm text-[#cbd1e0]">{m.desc}</div>
          </Link>
        ))}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-[#ccd2e3]">
        모든 문서는 PDF 입니다. 화면에서 바로 보거나 내려받아 인쇄할 수
        있습니다.
        <br />
        우리 운영 방식이 담겨 있으니 거래처에 그대로 넘기지 마세요.
      </p>
    </div>
  );
}
