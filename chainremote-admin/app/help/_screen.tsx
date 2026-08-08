// 매뉴얼용 화면 재현 조각.
//
// 스크린샷 대신 화면을 그려 넣는다. 이유가 둘이다.
//   ① 설치 화면은 실물을 캡처하려면 그때마다 윈도우에서 설치를 진행해야 하는데, 문서를
//      고칠 때마다 그럴 수는 없다.
//   ② 캡처 이미지는 버전이 오르면 조용히 낡는다. 그림은 바뀐 부분만 고치면 된다.
// 실제 창의 제목·버튼 이름은 실물에서 그대로 옮겼다 — 모양보다 그 단어가 길잡이가 된다.
// 나중에 실물 스크린샷이 생기면 이 자리를 그대로 바꿔 끼우면 된다.

/** 윈도우 표준 "사용자 계정 컨트롤" 창. 설치 중 가장 많이 당황하는 지점이다. */
export function UacScreen({ appName }: { appName: string }) {
  return (
    <figure className="my-3 overflow-hidden rounded-lg border border-[#566999] bg-[#1b2440]">
      <div className="border-b border-[#566999] px-3 py-2 text-xs text-[#cbd1e0]">
        사용자 계정 컨트롤
      </div>
      <div className="flex gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[#4c7dff]/20 text-xl">
          🛡️
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white">
            이 앱이 디바이스를 변경할 수 있도록 허용하시겠어요?
          </div>
          <div className="mt-2 text-xs text-[#cbd1e0]">
            {appName}
            <br />
            확인된 게시자: <span className="text-[#c3d3ff]">BetaposLab</span>
          </div>
          <div className="mt-3 flex gap-2">
            <span className="rounded bg-[#4c7dff] px-3 py-1 text-xs font-medium text-white">
              예
            </span>
            <span className="rounded border border-[#566999] px-3 py-1 text-xs text-[#cbd1e0]">
              아니요
            </span>
          </div>
        </div>
      </div>
      <figcaption className="border-t border-[#566999] px-3 py-2 text-[0.7rem] text-[#ccd2e3]">
        화면이 어두워지면서 이 창이 뜹니다. <b className="text-white">[예]</b> 를 눌러야 설치가
        진행됩니다.
      </figcaption>
    </figure>
  );
}

/** 설치 마법사 한 페이지. title/body 는 실물 문구를 그대로 넣는다. */
export function WizardScreen({
  step,
  title,
  children,
  primary = "다음",
  caption,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
  primary?: string;
  caption?: string;
}) {
  return (
    <figure className="my-3 overflow-hidden rounded-lg border border-[#566999] bg-[#1b2440]">
      <div className="flex items-center justify-between border-b border-[#566999] px-3 py-2">
        <span className="text-xs text-[#cbd1e0]">ChainRemote 설치</span>
        <span className="text-[0.68rem] text-[#ccd2e3]">{step}</span>
      </div>
      <div className="p-4">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-2 space-y-1 text-xs leading-relaxed text-[#cbd1e0]">{children}</div>
        <div className="mt-4 flex justify-end gap-2">
          <span className="rounded border border-[#566999] px-3 py-1 text-xs text-[#cbd1e0]">
            뒤로
          </span>
          <span className="rounded bg-[#4c7dff] px-3 py-1 text-xs font-medium text-white">
            {primary}
          </span>
        </div>
      </div>
      {caption && (
        <figcaption className="border-t border-[#566999] px-3 py-2 text-[0.7rem] text-[#ccd2e3]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/** 거래처 화면에 뜨는 수락 카드. 거래처에게 설명할 때 쓴다. */
export function AcceptCardScreen({ tenantName }: { tenantName: string }) {
  return (
    <figure className="my-3 overflow-hidden rounded-lg border-[3px] border-[#5A8CFF] bg-[#1b2440]">
      <div className="p-4">
        <div className="text-sm font-semibold text-white">원격지원 요청</div>
        <div className="mt-2 text-xs leading-relaxed text-[#cbd1e0]">
          <b className="text-white">{tenantName}</b> 에서 원격지원을 요청했습니다.
          <br />
          수락하시면 화면 공유가 시작됩니다.
        </div>
        <div className="mt-3 flex gap-2">
          <span className="rounded bg-[#4c7dff] px-4 py-1.5 text-xs font-medium text-white">
            수락
          </span>
          <span className="rounded border border-[#566999] px-4 py-1.5 text-xs text-[#cbd1e0]">
            거절
          </span>
        </div>
      </div>
      <figcaption className="border-t border-[#566999] px-3 py-2 text-[0.7rem] text-[#ccd2e3]">
        거래처 화면 위쪽에 뜹니다. <b className="text-white">[수락]</b> 을 눌러야 연결됩니다.
      </figcaption>
    </figure>
  );
}
