# cpal — ChainRemote 수정본

원본: <https://github.com/rustdesk-org/cpal> `osx-screencapturekit` 브랜치 `6b374bc`
(rustaudio/cpal 0.15.3 기반). 라이선스는 원본 그대로 Apache-2.0 (`LICENSE`).

## 왜 들여왔나

윈10 1703 이전(윈7·Windows Embedded Standard·윈8·윈10 LTSB 2016)에서 원격 소리가 0 이었다.
"재생 중인 소리 가로채기(루프백)"를 이벤트 방식으로 열면 그 OS 들은 신호를 한 번도 주지 않는다 —
MS 문서 *Loopback Recording* 에 명시된 제약이다. 원본은 그 신호를 시간 제한 없이 기다리므로
장치 열기와 형식 협상까지는 정상으로 끝나고(상대에겐 형식 메시지가 간다) 소리 데이터만 영영 안 나간다.

2026-11-04 테스트2(윈7 x86)에서 확인. 같은 맥 HQ 로 윈11 은 들렸다.

## 바꾼 것 (WASAPI 만)

- `src/host/wasapi/device.rs` — 입력 스트림이 루프백이고 OS 빌드가 15063 미만이면
  이벤트 없이(타이머 방식) 200ms 버퍼로 연다. 빌드 판정은 `RtlGetVersion`(매니페스트 영향 없음),
  실패하면 원래 경로.
- `src/host/wasapi/stream.rs` — 그런 스트림만 재생 중일 때 대기에 10ms 시간 제한을 두고,
  시간이 다 되면 이벤트가 온 것처럼 버퍼를 비운다.
- `Cargo.toml` — `windows` 기능 `Win32_System_SystemInformation`, `Wdk_System_SystemServices` 추가.

윈10 1703 이상, 출력(재생) 스트림, 마이크 입력은 원본과 같은 경로를 탄다.

## 원본을 다시 받을 때

위 세 곳을 다시 얹을 것. 루트 `Cargo.toml` 은 이 폴더를 경로 의존성으로 쓰고 workspace 에서는 뺀다
(`exclude`) — 원본의 dev-dependencies 가 우리 `Cargo.lock` 에 끌려 들어오지 않게.
