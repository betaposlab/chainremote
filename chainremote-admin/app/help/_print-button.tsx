"use client";

// 인쇄 / PDF 저장 버튼.
//
// 서버에서 PDF 를 만들지 않는다. puppeteer 같은 걸 붙이면 컨테이너에 크롬이 통째로 들어가고
//   한글 폰트를 따로 심어야 하는데, 얻는 건 브라우저가 이미 하는 일이다.
//   window.print() 를 부르면 사용자가 그 자리에서 "인쇄"와 "PDF로 저장"을 고를 수 있다.
//   모양은 globals.css 의 @media print 가 맡는다(흰 바탕·검은 글씨로 뒤집는다).

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn btn-ghost btn-sm no-print"
      title="인쇄 창에서 'PDF로 저장'을 고르면 파일로 받을 수 있습니다"
    >
      🖨 인쇄 · PDF 저장
    </button>
  );
}
