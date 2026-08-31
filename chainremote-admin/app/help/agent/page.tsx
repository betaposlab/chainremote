// 거래처 설치·사용 매뉴얼 — 로그인 필요.
// 본문은 manuals/agent.pdf 다. 내용을 고치려면 매뉴얼 소스(매뉴얼/ChainRemote_매뉴얼_소스.zip)
//   에서 PDF 를 다시 뽑아 그 파일을 덮어쓴다. 이 파일은 손댈 일이 없다.

import type { Metadata } from "next";
import { ManualPage } from "../_manual-page";

export const metadata: Metadata = {
  title: "거래처 설치·사용 매뉴얼 — ChainRemote",
};

export default function Page() {
  return <ManualPage slug="agent" />;
}
