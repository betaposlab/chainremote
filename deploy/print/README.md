# 대리점 안내서 (우편 발송용)

- `pamphlet.html` — **정본.** 고칠 때는 여기를 고친다.
- `체인리모트_대리점_안내서.pdf` — 인쇄소에 넘기거나 메일에 붙이는 파일. HTML 에서 뽑는다.

## PDF 다시 뽑기

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --virtual-time-budget=8000 --no-pdf-header-footer \
  --print-to-pdf="$PWD/deploy/print/체인리모트_대리점_안내서.pdf" \
  "file://$PWD/deploy/print/pamphlet.html"
```

브라우저 인쇄와 같은 엔진이라 A4 나눔과 인쇄용 CSS 가 그대로 간다.
`--virtual-time-budget` 은 웹폰트와 QR(스크립트로 그린다)이 그려질 시간을 준다 — 짧으면
글꼴이 대체 폰트로, QR 이 빈 칸으로 나간다. **뽑은 뒤에는 쪽수·크기·그림을 반드시 확인할 것**:

```
mdls -name kMDItemNumberOfPages -name kMDItemPageWidth 체인리모트_대리점_안내서.pdf
   → 4쪽 / 594.96pt(= A4 210mm) 이어야 정상
pdfimages -list 체인리모트_대리점_안내서.pdf
   → 1쪽 로고·수락카드·QR / 2쪽 배너 / 4쪽 관리화면·QR
     (3쪽 타임라인은 벡터라 여기 안 나오는 게 정상이고 인쇄 품질에 더 좋다)
```

## 판형

A4 4면. 양면 2장으로 접거나 A3 반접지로 뽑으면 봉투 한 통에 들어간다.
`.sheet` 는 높이가 고정이고 `overflow:hidden` 이라 **넘치면 조용히 잘린다.** 내용을 늘렸으면
브라우저에서 `scrollHeight - clientHeight` 가 네 면 모두 0 인지 확인하고 넘길 것.

## 그림 해상도

화면 캡처라 원본 해상도가 정해져 있다. 인쇄 권장은 300 DPI 인데, 표시 폭에 따라 이렇게 된다.

| 그림 | 실효 DPI |
|---|---|
| 관리 화면(4쪽) | 313 — 충분 |
| 수락 카드(1쪽) | 142 — 표지의 주인공이라 크기를 유지했다 |
| 원격 중 배너(2쪽) | 148 — 폭을 줄여 올렸다 |

더 올리려면 VM 에서 더 큰 화면으로 다시 찍는 수밖에 없다. 실물로 뽑아 보고 판단할 것.
