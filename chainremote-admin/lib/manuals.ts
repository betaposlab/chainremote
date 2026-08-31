// 매뉴얼 PDF 목록 — 도움말 화면과 배포 라우트가 함께 보는 한 벌의 표.
//
// 왜 PDF 인가(2026-08-28 Chang):
//   전에는 /help 밑에 문서를 HTML 로 따로 썼는데, 그림이 전부 코드로 그린 목업이었고
//   같은 내용이 PDF 와 두 벌로 갈라져 있었다. 버전이 오르면 한쪽만 고치고 다른 쪽이
//   조용히 낡는다. 그래서 **실물 스크린샷이 든 PDF 한 벌만 정본으로 둔다.**
//
// 왜 public/ 이 아닌가:
//   public/ 은 로그인 없이 열리고 검색엔진에 색인된다. 이 문서들에는 원격 ID 체계,
//   enroll-key 배포 흐름, 권한 구조가 통째로 들어 있다. 그래서 파일은 public/ 바깥
//   `manuals/` 에 두고 /api/manuals/[slug] 가 세션을 보고 흘려보낸다.
//   **네 편 모두 로그인해야 열린다** — 공개 문서는 없다. 거래처에 내보낼 문서가 생기면
//   그때 공개 경로를 새로 설계할 것. 슬쩍 한 편만 여는 예외는 두지 않는다.
//   → 컨테이너에 들어가야 하므로 Dockerfile 에 `COPY ... /app/manuals ./manuals` 가 있다.
//      **PDF 를 추가하면 이 표만 고치면 되고 Dockerfile 은 손대지 않는다.**
//
// 파일명에 버전을 박지 않는 이유: 링크가 버전마다 바뀌면 인쇄된 문서·주고받은 URL 이
//   전부 죽는다. 파일은 `install.pdf` 로 고정하고 버전은 아래 version 필드로만 표시한다.

export interface Manual {
  /** URL 조각. /help/{slug} 와 /api/manuals/{slug} 가 같이 쓴다. */
  slug: string;
  /** manuals/ 안의 파일 이름. */
  file: string;
  title: string;
  desc: string;
  /** 내려받을 때 붙는 이름. 사람이 파일을 봤을 때 뭔지 알아야 한다. */
  downloadName: string;
  version: string;
  updated: string;
}

export const MANUALS: Manual[] = [
  {
    slug: "install",
    file: "install.pdf",
    title: "설치 매뉴얼",
    desc: "HQ 앱과 거래처 에이전트를 내려받아 설치하는 방법. 설치 후 확인 절차까지.",
    downloadName: "ChainRemote_설치_매뉴얼.pdf",
    version: "v1.4.138",
    updated: "2026-08-28",
  },
  {
    slug: "hq",
    file: "hq.pdf",
    title: "HQ 사용법",
    desc: "화면 구성, 세 개의 탭, 원격 접속, 도구 모음, 지원기록 남기기, 자주 막히는 곳.",
    downloadName: "ChainRemote_본사HQ_사용매뉴얼.pdf",
    version: "v1.4.138",
    updated: "2026-08-28",
  },
  {
    slug: "panel",
    file: "panel.pdf",
    title: "관리 패널 사용법",
    desc: "대시보드, 거래처 등록과 배포, 지원기록 검색, 사용자 권한, 자주 막히는 곳.",
    downloadName: "ChainRemote_관리패널_사용매뉴얼.pdf",
    version: "v1",
    updated: "2026-08-28",
  },
  {
    slug: "agent",
    file: "agent.pdf",
    title: "거래처 설치·사용 매뉴얼",
    desc: "거래처 POS 에 에이전트를 까는 방법과, 원격지원을 받을 때 거래처가 할 일.",
    downloadName: "ChainRemote_거래처_설치사용_매뉴얼.pdf",
    version: "v1.4.138",
    updated: "2026-08-28",
  },
];

export function findManual(slug: string): Manual | undefined {
  return MANUALS.find((m) => m.slug === slug);
}
