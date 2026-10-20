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

## 백업 (`backup/`)

매일 03:40 클라우드가 DB·hbbs 키·스택 설정을 묶어 **서버 안에 만들어 두고**, 04:10 집 NAS 가
**가져간다.** 서버가 삭제되는 경우(미결제 9일)를 넘기려고 백업 본은 NAS 에 둔다.

| 파일 | 어디에 | 하는 일 |
|---|---|---|
| `chainremote-backup.sh` | 클라우드 `/usr/local/bin/`, cron 03:40 | 묶음을 `/var/backups/chainremote/` 에 만든다(최근 3개) |
| `cr-backup-serve.sh` | 클라우드 `/usr/local/bin/` | NAS 키의 강제 커맨드 — 최근 묶음 하나를 내준다. 26시간보다 오래되면 거절 |
| `cr-backup-pull.sh` | NAS `~chang/bin/`, DSM 작업 스케줄러 04:10(사용자 chang) | 받아서 검사(gzip·구성) 후 `~/cr-cloud-backup/` 에 보관(14개), `receive.log` |

★방향을 바꾼 이유(2026-10-20): 종전엔 클라우드가 NAS 의 SSH 로 밀어 넣었고, 그러려면 집
공유기에 22번이 열려 있어야 했다. 그 22번이 NAS 침입 경로였다. 지금은 집으로 들어오는 포트가
필요 없다. NAS 키(`chainremote-nas-backup-pull`)는 클라우드 root authorized_keys 에
`command=…,no-port-forwarding,…` 로만 등록돼 있어, 다른 명령·터널은 거절된다(둘 다 실제로 시험함).

확인: NAS `tail ~/cr-cloud-backup/receive.log` 에 매일 `OK pulled`, 클라우드
`tail /var/log/chainremote-backup.log` 에 `OK built` 다음 `SERVE … -> <집 IP>`.
