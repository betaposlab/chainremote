// 도움말 목차.
//
// 문서를 늘릴 때 여기 카드만 더하면 된다. 아직 안 쓴 문서는 "준비 중"으로 두되 목록에는
//   보여 준다 — 무엇이 생길지 알면 지금 없는 것을 찾아 헤매지 않는다.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "도움말 — ChainRemote 관리 패널" };

const DOCS = [
  {
    href: "/help/install",
    title: "설치 매뉴얼",
    desc: "HQ 앱과 거래처 에이전트를 내려받아 설치하는 방법. 설치 후 확인 절차까지.",
    ready: true,
  },
  {
    href: "/help/hq",
    title: "HQ 사용법",
    desc: "원격 접속, 즐겨찾기, 파일 전송, 지원기록 남기기.",
    ready: false,
  },
  {
    href: "/help/panel",
    title: "관리 패널 사용법",
    desc: "거래처 등록, 일괄 업데이트, 디스크·방화벽 관제, 문의함.",
    ready: false,
  },
  {
    href: "/help/customer",
    title: "거래처 안내문 (인쇄용)",
    desc: "매장에 두고 나올 한 장. “이 창이 뜨면 수락을 눌러 주세요”.",
    ready: false,
  },
];

export default function HelpIndexPage() {
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
        {DOCS.map((d) =>
          d.ready ? (
            <Link
              key={d.href}
              href={d.href}
              className="panel-card block p-4 transition-colors hover:bg-white/[0.04]"
            >
              <div className="font-semibold text-white">{d.title}</div>
              <div className="mt-1 text-sm text-[#cbd1e0]">{d.desc}</div>
            </Link>
          ) : (
            <div key={d.href} className="panel-card p-4 opacity-60">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-white">{d.title}</span>
                <span className="chip chip-neutral">준비 중</span>
              </div>
              <div className="mt-1 text-sm text-[#cbd1e0]">{d.desc}</div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
