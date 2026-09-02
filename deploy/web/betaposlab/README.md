# betaposlab.com 홈페이지 — **index.html 한 장만** 추적한다

## 범위 (오해하기 쉬운 자리)

여기 있는 건 `betaposlab.com/` 의 **첫 화면 한 장**뿐이다. 회사 웹 루트 전체가 아니다.

Cafe24 의 `www/` 에는 파일이 59개 있고 그 대부분은 **별개의 PHP 애플리케이션**이다
(`billing.php` · `cart.php` · `dashboard.php` · `config/` · `database/` …).
그건 이 프로젝트와 무관하고 `config/` 에 자격증명이 있을 수 있어 **가져오지 않는다.**
필요해지면 그 앱은 자기 저장소를 갖는 게 맞다.

## 왜 이 한 장을 가져왔나 (2026-09-02)

이 파일은 Cafe24 에만 있었다. **날아가면 되살릴 정본이 없다** — 그게 가져온 이유의 전부다.

★**체인리모트 링크는 일부러 넣지 않는다**(2026-09-02 Chang). 한때 여기에 링크를 넣어
검색 유입 경로를 만들려 했지만, **체인리모트는 626.kr 에서만 보이게 한다**로 정리됐다.
이 페이지는 Mini Keyboard 소개고 제품이 섞이면 둘 다 흐려진다.
잘못 들어온 사람의 출구는 626.kr 로그인 화면 안에 뒀다(`app/login/page.tsx` 의 [제품 소개 보기]).

그래서 이 폴더는 **당분간 백업 용도**다. 라이브와 다를 일이 없어야 정상이고,
다르면 둘 중 하나가 손대진 것이니 확인할 것:
```
curl -s https://betaposlab.com/ | shasum -a 256
shasum -a 256 deploy/web/betaposlab/index.html
```

## 올리는 법

`publish-landing.sh` 는 `www/chainremote/` 만 다룬다. 이 파일은 웹 루트라 대상이 아니다.
바꿨으면 `deploy/publish/publish-homepage.sh` 로 올린다(같은 SFTP 자격증명을 쓴다).

★올린 뒤에는 **공개 URL 로 실제 받아 sha 를 대조한다.** "업로드 성공" 로그만 믿지 않는다.
