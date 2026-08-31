# 매뉴얼 PDF 자리

이 폴더에 `install.pdf` · `hq.pdf` · `panel.pdf` · `agent.pdf` 네 개가 들어간다.
목록과 제목·버전은 [`../lib/manuals.ts`](../lib/manuals.ts) 가 갖고 있고, 이 폴더는
그 표가 가리키는 실제 파일이 놓이는 자리다.

## PDF 가 저장소에 없는 이유

**공개 저장소이기 때문이다.** HQ·패널 매뉴얼에는 원격 ID 체계와 enroll-key 배포 흐름이
통째로 들어 있어서, 패널은 이 파일들을 `public/` 이 아니라 여기 두고
`/api/manuals/[slug]` 가 로그인을 확인한 뒤에만 흘려보낸다. 같은 파일을 git 에 올리면
그 게이트가 `git clone` 한 번으로 무의미해진다 — 그래서 `.gitignore` 로 뺐다.

정본은 Chang 로컬의 `매뉴얼/` 폴더에 있다.

## 새로 받은 체크아웃에서 채우는 방법

`매뉴얼/` 의 PDF 를 아래 이름으로 복사해 넣는다. **파일명은 그대로 둘 것** — 링크에
버전을 박으면 인쇄된 문서와 주고받은 URL 이 전부 죽는다.

| 이 폴더 | 정본 |
|---|---|
| `install.pdf` | `매뉴얼/ChainRemote_설치_매뉴얼_v*.pdf` |
| `hq.pdf` | `매뉴얼/ChainRemote_본사HQ_사용매뉴얼_v*.pdf` |
| `panel.pdf` | `매뉴얼/ChainRemote_관리패널_사용매뉴얼_v*.pdf` |
| `agent.pdf` | `매뉴얼/ChainRemote_거래처_설치사용_매뉴얼_v*.pdf` |

내용을 고칠 때는 `매뉴얼/ChainRemote_매뉴얼_소스.zip` 을 풀어 스크린샷을 교체하고 PDF 를
다시 뽑은 뒤, 여기를 덮어쓰고 `../lib/manuals.ts` 의 `version`·`updated` 를 고친다.

## 비어 있으면 어떻게 되나

빌드와 배포는 그대로 된다(`Dockerfile` 이 이 폴더를 통째로 복사하므로 이 README 만 있어도
`COPY` 가 성립한다). 도움말 목차와 문서 화면도 뜬다. **PDF 를 요청하는 순간에만**
`/api/manuals/[slug]` 가 500 과 "매뉴얼 파일이 서버에 없습니다" 를 돌려준다 — 404 가
아닌 이유는 *문서가 없는 것*과 *배포에서 빠진 것*을 구분하기 위해서다.

배포는 `deploy/cloud/redeploy-panel.sh` 가 로컬 폴더를 그대로 보내므로, Chang 의 맥에서
올리는 한 이 폴더가 채워진 상태로 나간다.
