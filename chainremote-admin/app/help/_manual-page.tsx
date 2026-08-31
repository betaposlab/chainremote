// 매뉴얼 한 편을 그리는 서버 컴포넌트. /help/{slug} 네 페이지가 전부 이걸 부른다.
//
// 라우트를 [slug] 하나로 합치지 않은 이유: 문서 한 편이 곧 파일 한 장이라 목록과
//   실제 주소가 어긋날 수 없다. 동적 라우트 하나로 묶으면 "지금 어떤 URL 이 살아
//   있는가"를 lib/manuals.ts 까지 읽어야 알 수 있다.

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLiveUser } from "@/lib/auth-guard";
import { findManual } from "@/lib/manuals";
import { ManualViewer } from "./_viewer";

export async function ManualPage({ slug }: { slug: string }) {
  const m = findManual(slug);
  if (!m) notFound();

  // 화면 게이트. 파일 자체는 /api/manuals/[slug] 가 한 번 더 막는다 —
  //   화면만 막으면 URL 을 직접 친 사람에게 그대로 열린다.
  await requireLiveUser();

  const src = `/api/manuals/${m.slug}`;

  return (
    <div className="px-4 py-5 md:px-8 md:py-6">
      <header className="mb-4">
        <Link href="/help" className="text-xs text-[#c3d3ff] hover:underline">
          ← 도움말 목차
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              {m.title}
            </h1>
            <p className="mt-1 text-xs text-[#ccd2e3]">
              {m.version} · 최종 수정 {m.updated}
            </p>
          </div>
          {/* 넓은 화면에서도 버튼은 남긴다 — 뷰어로 읽다가 인쇄하러 가는 길이다 */}
          <div className="hidden gap-2 md:flex">
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sm"
            >
              새 탭에서 보기
            </a>
            <a href={`${src}?dl=1`} className="btn btn-primary btn-sm">
              ⬇ 내려받기
            </a>
          </div>
        </div>
      </header>

      <ManualViewer src={src} title={m.title} />
    </div>
  );
}
