// 임시 원격 — 대리점 번호 숫자판 (2026-10-01).
//
// 주소가 /login 아래인 이유: proxy.ts 의 로그인 면제가 `login` 으로 시작하는 경로다. 포스 앞의
// 사장님이 로그인 없이 여는 화면이라 면제 안에 있어야 하고, 면제 목록을 넓히는 것보다
// 이미 열린 자리에 두는 편이 안전하다. 고객은 이 주소를 치지 않는다 — 초록 버튼이 데려온다.

import type { Metadata } from "next";
import { SupportKeypad } from "./_keypad";

export const metadata: Metadata = { title: "원격지원 받기" };

export default function SupportPage() {
  return (
    <div className="aurora-bg flex min-h-screen w-full flex-col items-center justify-center bg-[#2b364f] px-4 py-8">
      <div className="relative z-10 w-full max-w-md rounded-xl border border-[#566999] bg-[#3d4e7a] p-7 shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
        <SupportKeypad />
      </div>
    </div>
  );
}
