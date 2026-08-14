# 클라우드(iwinv chainremote-01) 앞단 설정

`root@115.68.192.153` 의 실제 파일과 **손으로 동기화**하는 사본이다. 서버를 다시 세울 일이
생기면 여기서 되살린다 — 종전엔 서버에만 있어서 재구축하면 조용히 사라질 자리였다.

## Caddyfile

```bash
# 서버 → 저장소 (지금 상태 떠오기)
ssh root@115.68.192.153 'cat /etc/caddy/Caddyfile' > deploy/cloud/Caddyfile

# 저장소 → 서버 (복구/변경 적용)
scp deploy/cloud/Caddyfile root@115.68.192.153:/etc/caddy/Caddyfile
ssh root@115.68.192.153 'caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy'
```

★`validate` 를 먼저 통과시키고 reload 할 것. 문법 오류로 죽으면 패널·하트비트가 통째로 끊긴다.

## 여기서 다루는 것

- `626.kr` / `api.626.kr` → 패널(127.0.0.1:3001). TLS 자동 발급·갱신.
- `626.kr/main` → 영업 랜딩 정적 서빙(`/opt/chainremote/web/main/`).
  파일 갱신은 `deploy/publish/publish-landing.sh` 의 [7/7] 이 자동으로 한다.

## 패널 재배포

`deploy/cloud/redeploy-panel.sh` 하나뿐이다. NAS 판은 2026-08-14 삭제했다 — NAS 옛 스택을
중지한 날 그 스크립트는 "배포했는데 아무것도 안 바뀜"을 만드는 지뢰가 됐다.
