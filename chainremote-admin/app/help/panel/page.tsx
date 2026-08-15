// 관리 패널 사용법.
//
// HQ 사용법과 짝을 이루는 문서다. HQ 는 "원격을 거는 곳", 패널은 "관리하는 곳" 이라는
// 구분을 문서 첫머리에서 못박고 시작한다 — 둘을 헷갈리는 것이 가장 흔한 혼란이다.
//
// 역할(owner/admin/operator/viewer)에 따라 안 보이는 메뉴가 있다. 문서에서 그 사실을
// 숨기면 "내 화면엔 그 버튼이 없는데요" 가 문의로 돌아온다. 그래서 권한이 갈리는 자리마다
// 누구에게 보이는지 적었다.

import type { Metadata } from "next";
import { DocHeader, Danger, Note, Section, Steps, UI, Warn } from "../_ui";

export const metadata: Metadata = { title: "관리 패널 사용법 — ChainRemote 도움말" };

function Item({
  name,
  children,
  when,
  who,
}: {
  name: string;
  children: React.ReactNode;
  when?: string;
  who?: string;
}) {
  return (
    <div className="mb-3 rounded-lg border border-[#3a4a72] bg-white/[0.02] p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white">{name}</span>
        {who && <span className="chip chip-neutral text-[11px]">{who}</span>}
      </div>
      <div className="text-sm leading-relaxed text-[#dfe4f0]">{children}</div>
      {when && (
        <div className="mt-1.5 text-xs text-[#9fb0d8]">
          <span className="font-medium text-[#c3d3ff]">언제 </span>
          {when}
        </div>
      )}
    </div>
  );
}

export default function PanelHelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
      <DocHeader
        title="관리 패널 사용법"
        lead="거래처를 등록하고, 프로그램을 배포하고, 지원기록을 들여다보는 곳입니다. 브라우저에서 626.kr 로 들어옵니다."
        updated="2026-08-15"
      />

      <Section title="HQ 와 무엇이 다른가">
        <p>
          <b>HQ 앱은 원격을 거는 곳</b>이고, <b>패널은 관리하는 곳</b>입니다. 둘은 같은 데이터를
          봅니다 — 패널에서 거래처를 등록하면 HQ 목록에 나타나고, HQ 에서 원격을 마치고 남긴
          기록이 패널 지원기록에 쌓입니다.
        </p>
        <Note>
          한 가지만 기억하시면 됩니다. <b>거래처 명부의 원본은 패널입니다.</b> HQ 는 그걸 받아
          보여 줄 뿐이라, 패널에서 바꾼 내용이 HQ 에 안 보이면 HQ 에서 <UI>새로고침</UI> 을
          누르시면 됩니다.
        </Note>
      </Section>

      <Section n={1} title="대시보드">
        <p>들어오면 처음 보이는 화면입니다. 지금 상태를 한눈에 봅니다.</p>
        <Item name="온라인 / 전체" when="아침에 한 번. 꺼진 곳이 늘었는지 봅니다.">
          거래처 PC 중 지금 켜져 있는 수. 거래처는 10분마다 신호를 보내므로, 껐다면 곧
          오프라인으로 바뀝니다.
        </Item>
        <Item name="이번 달 지원" when="월말에 실적을 볼 때.">
          이번 달 1일부터 지금까지의 원격 건수입니다.
        </Item>
        <Item name="관제 경고" when="빨간 숫자가 보일 때 바로.">
          디스크가 부족하거나, 카드결제 데몬이 멈췄거나, 방화벽이 켜진 곳을 모아 보여 줍니다.
          누르면 해당 거래처로 갑니다.
        </Item>
        <Item name="업데이트 내역" when="새 버전이 뭘 고쳤는지 볼 때.">
          발행된 버전과 변경 내용입니다.
        </Item>
      </Section>

      <Section n={2} title="거래처 — 가장 많이 쓰는 화면">
        <p>등록된 거래처가 표로 나옵니다. 한 줄이 PC 한 대입니다.</p>

        <h3 className="mt-4 mb-2 font-semibold text-white">표에서 읽는 것</h3>
        <Item name="상태 (온라인 / 오프라인)">
          10분 안에 신호가 왔으면 온라인입니다. 오프라인이면 PC 가 꺼졌거나 인터넷이 끊긴
          것입니다 — 원격이 안 되는 이유를 여기서 먼저 확인하시면 됩니다.
        </Item>
        <Item name="OS · 여유공간">
          윈도우 종류와 비트 수, C드라이브 남은 용량. 여유가{" "}
          <b className="text-[#ff9b9b]">5GB 미만이면 빨강</b>,{" "}
          <b className="text-[#ffd479]">8GB 미만이면 노랑</b>입니다.
        </Item>
        <Item name="방화벽 · 데몬 관제">
          켜 둔 곳만 표시됩니다. 카드결제 데몬(KSNET 등)이 멈추면 여기 빨갛게 뜹니다.
        </Item>

        <h3 className="mt-5 mb-2 font-semibold text-white">버튼</h3>
        <Item name="+ 거래처 추가" who="마스터 · 관리자" when="새 매장에 설치하러 가기 전.">
          상호와 담당자를 미리 등록해 둡니다. 사실 <b>미리 안 해도 됩니다</b> — 설치할 때 상호를
          입력하면 스스로 등록되니까요(아래 3번).
        </Item>
        <Item name="에이전트 다운로드" when="신규 거래처에 설치할 때. 항상 여기서 받으세요.">
          거래처용 설치 파일을 받습니다.
          <Danger>
            <b>반드시 이 버튼으로 받은 파일이어야 합니다.</b> 다른 경로로 받은 파일에는 회사
            식별자가 안 들어 있어, 설치는 되는데 <b>패널에 영영 안 나타나고 자동 업데이트도
            안 붙습니다.</b> 겉으론 멀쩡히 원격이 되기 때문에 몇 달 뒤에야 발견됩니다.
          </Danger>
        </Item>
        <Item name="⬆ 푸시 (행마다)" who="마스터 · 관리자" when="특정 거래처만 새 버전으로 올릴 때.">
          그 거래처 한 곳에만 업데이트를 예약합니다. 최대 10분 안에 조용히 설치됩니다.
        </Item>
        <Item
          name="⬆ 전체 일괄 푸시"
          who="마스터 · 관리자"
          when="새 버전이 나왔을 때. 보통 우리가 안내드립니다."
        >
          모든 거래처를 새 버전으로 올립니다.
          <Warn>
            <b>살아 있는 거래처 전부에 즉시 영향을 줍니다.</b> 그래서 이 버튼만은 사람이 직접
            누르게 해 두었습니다. 영업시간을 피해 누르시는 편이 안전합니다.
          </Warn>
        </Item>
        <Item name="수정" who="마스터 · 관리자">
          상호·담당자·연락처·메모를 고칩니다. 내부 기기(우리 PC)로 표시해 두면 과금과 일괄
          푸시에서 빠집니다.
        </Item>
      </Section>

      <Section n={3} title="새 거래처 등록하는 흐름">
        <Steps
          items={[
            <>
              패널에서 <UI>에이전트 다운로드</UI> 로 설치 파일을 받아 매장 PC 로 옮깁니다
              (USB·메신저 무엇이든).
            </>,
            <>
              더블클릭 → <b>상호를 입력</b> → 설치. 그게 전부입니다.
            </>,
            <>
              설치가 끝나면 거래처가 <b>스스로 패널에 등록</b>됩니다. 목록에{" "}
              <UI>미확정</UI> 으로 나타납니다.
            </>,
            <>
              패널에서 <UI>확정</UI> 을 누르면 정식 등록입니다. <b>확정은 마스터만</b> 할 수
              있습니다.
            </>,
          ]}
        />
        <Note>
          기기를 교체했거나 재설치한 경우, 서버가 상호를 보고 &ldquo;같은 곳의 새 PC&rdquo; 인지
          판단합니다. 애매하면 패널에 알림을 띄우니 <UI>이동</UI> / <UI>개명</UI> /{" "}
          <UI>무시</UI> 중에 골라 주시면 됩니다.
        </Note>
      </Section>

      <Section n={4} title="지원기록">
        <p>HQ 에서 원격을 마치고 남긴 기록이 여기 쌓입니다.</p>
        <Item name="검색" when="옛날 일을 찾을 때.">
          내용·거래처 상호·응대자·담당 직원을 한 번에 훑습니다. &ldquo;프린터&rdquo; 처럼 증상
          한 단어로 찾으시면 됩니다.
        </Item>
        <Item name="기간 · 거래처 고르고 [조회]" when="범위를 좁힐 때.">
          기본은 <b>최근 30일</b>입니다.
          <Note>
            찾는 게 안 나오면 기간 때문일 수 있습니다. 그런 경우 화면이{" "}
            <b>&ldquo;최근 30일 밖에 N건이 더 있습니다&rdquo;</b> 라고 알려 주니, 그 버튼을
            누르시면 전체 기간에서 다시 찾습니다.
          </Note>
        </Item>
        <Item name="전체 보기">
          검색 조건을 지우고 처음 화면으로 돌아갑니다.{" "}
          <b>기록이 삭제되는 것이 아닙니다</b> — 조건만 풀립니다.
        </Item>
        <Item name="행 펼치기 (▸)">
          누르면 그 건의 상세가 나옵니다. 담당 직원, 응대자, A/S 종류, 연결 경로까지 보입니다.
        </Item>
        <Item name="기록 편집" when="원격을 끊으면서 내용을 못 적었을 때.">
          행을 펼치고 <UI>기록 편집</UI> 을 누르면 장애 유형·해결 여부·응대자·내용을 나중에
          채우거나 고칠 수 있습니다. 시작·종료 시각은 고칠 수 없습니다 — 원격 시간은 사실
          기록입니다.
        </Item>
        <Item name="기록 추가" when="전화로만 처리했거나 원격 없이 도와줬을 때.">
          오른쪽 위 <UI>+ 기록 추가</UI>. 거래처와 시각을 고르고 내용을 적습니다. 원격 세션과
          구분되도록 <b>수동</b> 표식이 붙습니다.
        </Item>
        <Item name="기록 폐기 · 폐기 포함">
          잘못 남긴 기록은 <UI>기록 폐기</UI> 로 목록에서 숨깁니다. <b>지워지는 게 아닙니다</b>{" "}
          — 조회 줄의 <UI>폐기 포함</UI> 을 켜면 다시 보이고 <UI>폐기 취소</UI> 로 되살릴 수
          있습니다.
          <Note>
            <b>규칙:</b> 원격이 <b>15초 이상</b>이면 내용을 안 적어도 &ldquo;누가 언제 어디를
            원격했나&rdquo;는 반드시 남습니다(폐기해도 숨길 뿐). <b>15초 미만</b> 오접속은
            아예 기록하지 않습니다. 나중에 &ldquo;그때 원격했다/안 했다&rdquo;를 확인해야 할 때
            여기서 찾습니다.
          </Note>
        </Item>
      </Section>

      <Section n={5} title="문의함">
        <p>
          쓰다가 막히거나, 이랬으면 좋겠다 싶은 게 있으면 남겨 주세요. 우리가 읽고 답합니다.
        </p>
        <Note>
          <b>다른 대리점의 글은 보이지 않습니다.</b> 게시판이 아니라 1:1 문의함입니다.
        </Note>
      </Section>

      <Section n={6} title="사용자">
        <p>회사 직원 계정을 관리합니다.</p>
        <Item name="직원 추가" who="마스터">
          이메일과 이름을 넣으면 계정이 생깁니다. <b>첫 비밀번호는 1234</b> 이니 받은 분이 바로
          바꾸도록 안내해 주세요.
        </Item>
        <Item name="권한">
          <div className="space-y-1.5">
            <div>
              <b className="text-white">마스터</b> — 전부. 직원 관리, 거래처 확정·삭제, 일괄
              푸시.
            </div>
            <div>
              <b className="text-white">관리자</b> — 거래처 등록·수정, 푸시. 직원 관리는 안 됩니다.
            </div>
            <div>
              <b className="text-white">기사</b> — 원격 지원과 기록 남기기. 거래처 추가까지.
            </div>
            <div>
              <b className="text-white">조회</b> — 보기만.
            </div>
          </div>
        </Item>
        <Item name="비밀번호 초기화" who="마스터">
          직원이 비밀번호를 잊었을 때 1234 로 되돌립니다.
        </Item>
      </Section>

      <Section n={7} title="자주 막히는 곳">
        <Item name="설치했는데 패널에 안 나타나요">
          거의 항상 <b>다른 경로로 받은 설치 파일</b> 때문입니다. 패널의{" "}
          <UI>에이전트 다운로드</UI> 로 다시 받아 설치하시면 해결됩니다.
        </Item>
        <Item name="HQ 목록에 방금 등록한 거래처가 없어요">
          HQ 에서 <UI>새로고침</UI> 을 눌러 주세요. HQ 는 로그인할 때 목록을 받아 두기 때문에
          그 뒤 패널에서 바뀐 건 자동으로 안 들어옵니다.
        </Item>
        <Item name="일괄 푸시를 눌렀는데 버전이 그대로예요">
          거래처 PC 가 꺼져 있으면 켜질 때까지 기다립니다. 켜진 뒤 최대 10분 안에 설치되고,
          원격 중이면 끝날 때까지 미룹니다.
        </Item>
        <Item name="지원기록에 아무것도 없어요">
          기간이 <b>최근 30일</b> 로 잡혀 있어서일 수 있습니다. <UI>전체</UI> 로 바꾸고{" "}
          <UI>조회</UI> 를 눌러 보세요.
        </Item>
        <Item name="원격이 안 붙어요">
          그 거래처가 <b>온라인</b> 인지 먼저 보세요. 오프라인이면 PC 가 꺼진 것이라 원격으로는
          할 수 있는 게 없습니다. 온라인인데 안 되면 사장님이 수락을 안 누른 경우입니다.
        </Item>
      </Section>

      <Section title="더 궁금하면">
        <p>
          HQ 앱 사용법은 <b>도움말 → HQ 사용법</b> 에 있습니다. 문서에 없는 것은{" "}
          <b>문의함</b> 으로 남겨 주시면 답을 드리고, 자주 나오는 질문은 이 문서에 넣겠습니다.
        </p>
      </Section>
    </div>
  );
}
