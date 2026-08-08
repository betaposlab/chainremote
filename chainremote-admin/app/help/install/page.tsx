// 설치 매뉴얼. 대리점이 가장 먼저 만나는 문서다.
//
// 처음 설치하는 사람이 화면을 보며 그대로 따라가는 것을 목표로 쓴다. 요약본이 아니다 —
//   "무엇을 누른다"만 적힌 문서는 아는 사람에게만 읽힌다. 그래서 단계마다 그 순간 뜨는
//   화면을 같이 그려 넣었다(_screen.tsx). 특히 UAC 는 설치가 멈추는 가장 흔한 지점이다.
//
// 문구는 실물에서 그대로 옮겼다(인스톨러 마법사, 약관 첫 줄, 수락 카드). 모양보다 그 단어가
//   길잡이가 되므로, 화면이 바뀌면 여기 문구도 같이 고쳐야 한다.

import type { Metadata } from "next";
import { DocHeader, Danger, Note, Section, UI, Warn } from "../_ui";
import { AcceptCardScreen, UacScreen, WizardScreen } from "../_screen";

export const metadata: Metadata = { title: "설치 매뉴얼 — ChainRemote 도움말" };

/** 큰 단계 하나. 번호를 크게 달아 "지금 몇 번째인지"가 스크롤 중에도 보이게 한다. */
function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5 rounded-lg border border-[#51638f] bg-[#3b5291]/15 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4c7dff] text-sm font-bold text-white">
          {n}
        </span>
        <h3 className="font-semibold text-white">{title}</h3>
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-[#eef1f7]">{children}</div>
    </div>
  );
}

export default function InstallGuidePage() {
  return (
    <div className="print-doc px-4 py-5 md:px-8 md:py-6 max-w-3xl">
      <DocHeader
        title="설치 매뉴얼"
        lead="처음 설치하는 분이 화면을 보며 그대로 따라갈 수 있게 썼습니다. 설치할 프로그램은 두 가지입니다 — 본사 직원 PC에 까는 HQ 앱, 그리고 거래처 POS에 까는 에이전트."
        updated="2026-08-08"
      />

      <Danger>
        <b>거래처용 에이전트는 반드시 이 패널의 [에이전트 다운로드] 버튼으로 받으세요.</b>{" "}
        다른 곳에서 받은 설치파일에는 대리점 식별 정보가 없어, 설치해도 패널에 영영 나타나지
        않고 자동 업데이트도 받지 못합니다. 겉으로는 정상 설치된 것처럼 보여 알아채기 어렵습니다.
      </Danger>

      {/* ───────────────── HQ ───────────────── */}
      <Section title="① 본사 직원 PC — HQ 앱 설치">
        <p>
          거래처에 원격으로 접속할 때 쓰는 프로그램입니다. 직원이 쓰는 PC마다 한 번씩
          설치합니다. 5분이면 끝납니다.
        </p>

        <Step n={1} title="설치파일 받기">
          <p>
            이 패널 왼쪽 메뉴에서 <UI>대시보드</UI> 를 누르면 <b>설치파일</b> 이라는 상자가
            있습니다. 거기 <UI>HQ 다운로드</UI> 를 누르세요.
          </p>
          <p className="text-[#cbd1e0]">
            브라우저 아래쪽이나 오른쪽 위에 <code>ChainRemote_HQ_Setup_v1.4.93.exe</code> 같은
            이름의 파일이 받아집니다. (숫자는 버전이라 그때그때 다릅니다)
          </p>
        </Step>

        <Step n={2} title="파일 실행 — 파란 방패 창이 뜹니다">
          <p>받은 파일을 두 번 눌러 실행합니다. 그러면 이 창이 먼저 뜹니다.</p>
          <UacScreen appName="ChainRemote_HQ_Setup_v1.4.93.exe" />
          <p>
            윈도우가 &ldquo;이 프로그램이 컴퓨터를 바꿔도 되느냐&rdquo;고 묻는 것입니다.
            <b> [예]</b> 를 눌러야 설치가 시작됩니다. 여기서 [아니요]를 누르면 아무 일도
            일어나지 않습니다.
          </p>
          <Note>
            이 창이 안 보이면 화면 아래 작업 표시줄에서 깜빡이고 있을 수 있습니다. 눌러서
            앞으로 꺼내 주세요.
          </Note>
        </Step>

        <Step n={3} title="약관 동의">
          <WizardScreen
            step="1 / 3"
            title="서비스 이용약관"
            primary="다음"
            caption="[동의함]을 고른 뒤 [다음]을 누르세요."
          >
            <p>ChainRemote 서비스 이용약관 (약관 버전 1.0)</p>
            <p>◉ 동의함 &nbsp;&nbsp; ○ 동의하지 않음</p>
          </WizardScreen>
        </Step>

        <Step n={4} title="설치 완료 — 로그인">
          <p>
            설치가 끝나면 ChainRemote 가 저절로 실행되고 <b>로그인 화면</b>이 뜹니다. 이 패널에
            쓰는 것과 <b>똑같은 아이디·비밀번호</b>를 넣으세요.
          </p>
          <p className="text-[#cbd1e0]">
            로그인하면 거래처 목록이 보입니다. 여기서 거래처를 누르면 원격이 시작됩니다.
          </p>
          <Warn>
            <b>한 아이디로 동시에 원격할 수 있는 건 한 대뿐입니다.</b> 직원이 둘이면 아이디도
            둘이어야 합니다. 같은 아이디로 다른 PC에서 접속하면 먼저 쓰던 쪽이 끊깁니다.
            계정은 패널 <UI>사용자</UI> 화면에서 만듭니다.
          </Warn>
        </Step>
      </Section>

      {/* ───────────────── 에이전트 ───────────────── */}
      <Section title="② 거래처 POS — 에이전트 설치">
        <p>
          거래처 매장의 POS·키오스크에 까는 프로그램입니다. 한 번 깔아 두면 본사에서 원격으로
          접속할 수 있고, <b>거래처가 평소에 조작할 일은 없습니다.</b>
        </p>

        <Step n={1} title="우리 대리점 전용 설치파일 받기">
          <p>
            패널 <UI>대시보드</UI> → <b>설치파일</b> 상자에서 <UI>에이전트 다운로드</UI> 를
            누릅니다. 확인 창이 뜨면 그대로 진행하세요.
          </p>
          <p className="text-[#cbd1e0]">
            잠시 &ldquo;준비 중&hellip;&rdquo; 이 뜬 뒤 파일이 받아집니다. 이 파일에는 우리
            대리점 정보가 들어 있어, <b>설치하면 자동으로 우리 패널에 등록</b>됩니다.
          </p>
        </Step>

        <Step n={2} title="거래처 PC로 파일 옮기기">
          <p>
            받은 파일을 거래처 POS로 옮깁니다. USB, 카카오톡, 메일, 쓰던 원격 프로그램 — 편한
            방법이면 무엇이든 됩니다.
          </p>
        </Step>

        <Step n={3} title="실행 — 여기서도 파란 방패 창">
          <p>거래처 PC에서 파일을 두 번 눌러 실행합니다.</p>
          <UacScreen appName="ChainRemote_Agent_Setup_v1.4.91.exe" />
          <p>
            <b>[예]</b> 를 누릅니다. 거래처 사장님이 직접 하실 때는 이 창을 미리 말씀드리는 게
            좋습니다 — 처음 보면 대개 여기서 멈칫합니다.
          </p>
        </Step>

        <Step n={4} title="약관 동의">
          <WizardScreen
            step="1 / 4"
            title="ChainRemote 거래처용 소프트웨어 설치 및 원격 지원 동의서"
            primary="다음"
            caption="원격 지원을 받는 데 대한 동의입니다. [동의함] 후 [다음]."
          >
            <p>(약관 버전 1.0, 2026-06-12)</p>
            <p>
              소프트웨어는 설치 후 백그라운드 서비스로 상주하며, 지원 사업자의 원격 지원에
              쓰입니다.
            </p>
            <p>◉ 동의함 &nbsp;&nbsp; ○ 동의하지 않음</p>
          </WizardScreen>
        </Step>

        <Step n={5} title="★ 거래처 상호 입력 — 가장 중요한 화면">
          <WizardScreen
            step="2 / 4"
            title="거래처 상호"
            primary="다음"
            caption="여기 넣은 이름이 패널 목록에 그대로 나타납니다."
          >
            <p>이 PC가 설치될 매장(거래처)의 상호를 입력하세요.</p>
            <p>
              상호 (매장명): <span className="text-white">［ 행복마트 본점 ］</span>
            </p>
          </WizardScreen>
          <p>
            매장 이름을 적습니다. 여기 넣은 이름이 <b>패널 거래처 목록에 그대로</b> 나타나므로,
            나중에 알아보기 쉬운 이름으로 넣으세요. 지점이 여럿이면 &ldquo;○○마트
            본점&rdquo;처럼 구분되게 적는 게 좋습니다.
          </p>
          <Warn>
            <b>신규든 재설치든 항상 입력합니다.</b> 같은 매장이면 <b>전과 똑같은 상호</b>를
            그대로 넣으세요. 재설치는 아무 일도 일어나지 않고, POS를 바꿨거나 기기를 옮긴
            경우는 서버가 상호를 보고 알아서 정리합니다.
            <br />
            비워 두면 임시 이름으로 등록되고, 나중에 패널에서 이름을 지정할 수 있습니다.
          </Warn>
        </Step>

        <Step n={6} title="설치 완료 확인">
          <p>
            설치가 끝나면 화면 오른쪽 아래 시계 옆(트레이)에 ChainRemote 아이콘이 생깁니다.
            숨어 있으면 <UI>∧</UI> 를 눌러 펼치면 보입니다.
          </p>
          <p>
            이제 패널 <UI>거래처</UI> 화면을 새로고침해 보세요. 방금 설치한 매장이 목록에
            나타납니다. <b>몇 분 걸릴 수 있습니다.</b>
          </p>
        </Step>
      </Section>

      {/* ───────────────── 확인 ───────────────── */}
      <Section title="③ 잘 됐는지 확인하기">
        <p>아래 세 가지가 맞으면 정상입니다.</p>
        <div className="space-y-2">
          <div className="rounded-lg border border-[#51638f] p-3">
            <b className="text-white">1. 패널에 초록 점이 보인다</b>
            <p className="mt-1 text-[#cbd1e0]">
              <UI>거래처</UI> 목록에서 그 매장 줄의 상태에 초록 점과 버전(예: v1.4.91)이 보이면
              연결된 상태입니다.
            </p>
          </div>
          <div className="rounded-lg border border-[#51638f] p-3">
            <b className="text-white">2. 원격 접속이 시작된다</b>
            <p className="mt-1 text-[#cbd1e0]">
              거래처 줄의 <UI>원격접속</UI> 을 누르면 HQ 앱이 뜨면서 연결을 시도합니다.
            </p>
          </div>
          <div className="rounded-lg border border-[#51638f] p-3">
            <b className="text-white">3. 거래처 화면에 수락 카드가 뜬다</b>
            <AcceptCardScreen tenantName="○○텔레콤" />
            <p className="text-[#cbd1e0]">
              거래처가 <UI>수락</UI> 을 누르면 화면이 열립니다. 표시되는 이름은 패널에 설정한
              우리 상호입니다.
            </p>
          </div>
        </div>
        <Note>
          <b>거래처가 할 일은 이 수락 버튼 하나입니다.</b> 매번 눌러야 하며, 그래야 거래처가
          원격을 통제할 수 있습니다. 설치를 마치고 사장님께 &ldquo;이 창이 뜨면 수락을 눌러
          주세요&rdquo; 한마디만 해두시면 됩니다.
        </Note>
      </Section>

      {/* ───────────────── 문제 해결 ───────────────── */}
      <Section title="④ 잘 안 될 때">
        <div className="space-y-3">
          <div>
            <b className="text-white">설치는 됐는데 패널에 안 나타납니다.</b>
            <p className="mt-1 text-[#cbd1e0]">
              다른 경로로 받은 설치파일일 가능성이 높습니다. 이 패널의{" "}
              <UI>에이전트 다운로드</UI> 로 다시 받아 <b>덮어 설치</b>하면 해결됩니다. 기존
              설정과 등록 정보는 그대로 유지되니 안심하고 다시 까셔도 됩니다.
            </p>
          </div>
          <div>
            <b className="text-white">파란 방패 창에서 [예]가 눌리지 않습니다.</b>
            <p className="mt-1 text-[#cbd1e0]">
              그 PC의 윈도우 계정이 관리자가 아닐 수 있습니다. 매장 관리자 계정으로 로그인한 뒤
              다시 실행하거나, 설치파일을 마우스 오른쪽 버튼으로 눌러{" "}
              <UI>관리자 권한으로 실행</UI> 을 골라 보세요.
            </p>
          </div>
          <div>
            <b className="text-white">계속 오프라인으로만 표시됩니다.</b>
            <p className="mt-1 text-[#cbd1e0]">
              그 PC가 꺼져 있거나 절전 상태일 수 있습니다. 전원이 켜져 있는데도 그렇다면 인터넷
              연결과, 백신·보안 프로그램이 막고 있지 않은지 확인해 주세요.
            </p>
          </div>
          <div>
            <b className="text-white">구형 POS(윈도우 7 등)에도 됩니까?</b>
            <p className="mt-1 text-[#cbd1e0]">
              됩니다. 설치파일 하나로 윈도우 7·32비트부터 윈도우 11까지 지원하며, 설치할 때 그
              PC에 맞는 쪽이 자동으로 선택됩니다. 따로 받을 파일은 없습니다.
            </p>
          </div>
          <div>
            <b className="text-white">그래도 안 되면</b>
            <p className="mt-1 text-[#cbd1e0]">
              <UI>문의하기</UI> 로 알려 주세요. 화면 사진을 함께 올려 주시면 원인을 훨씬 빨리
              찾을 수 있습니다.
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}
