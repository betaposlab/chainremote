# 윈컴 배포 템플릿 (Step C 진행 시 핵심 자산)

거래처용 ChainRemote 윈컴 셋업 자동화 스크립트.

## 파일

- **RustDesk2.toml** — NAS 시그널링 서버(`sepani.synology.me`) + 공개키 + 무인접속 설정
- **setup.ps1** — 첫 셋업: 프로세스 종료 → 실행파일 검색 → toml 적용 → 비번 설정 → 자동시작 등록 → 재실행
- **fix.ps1** — 기존 셋업 수정용 (approve-mode 변경 등)
- **적용방법.txt** — 수동 적용 안내 (스크립트 못 쓸 때 폴백)

## 현재 한계 (Step C에서 해결)

1. **HTTP 호스팅이 Mac LAN(`192.168.68.108:8765`)에 하드코딩**
   - 거래처 배포 시 → S3/Cloudflare R2/Vercel 등 공개 CDN으로 옮겨야 함
2. **`--password` 플래그가 현재 ChainRemote 빌드에서 작동 안 함**
   - 거래처마다 영구 비번을 UI에서 직접 1회 설정 필요
   - 또는 RustDesk.toml 비번 해시 형식 분석해서 직접 주입
3. **거래처마다 다른 비번** — 현재는 `chain1234`/`Ch042558~` 단일
   - 운영 시 거래처별 비번 + 관리 패널 DB 저장 필요

## 검증된 워크플로우 (2026-05-01)

1. Mac에서 `python3 -m http.server 8765` (이 폴더에서)
2. 윈컴에서 PowerShell: `iex (irm http://<Mac LAN IP>:8765/setup.ps1)`
3. 윈컴 UI에서 영구 비밀번호 1회 설정 (보안 탭)
4. Mac에서 ID로 접속 → 비번 입력 → 윈컴 클릭 0 = 무인 연결

이걸 거래처에 배포하려면 1번을 공개 호스팅으로 대체 + 2번 한 줄을 거래처에 카톡 등으로 전달.
