# ChainRemote — Mac / Windows 빌드 함정

> Mac 빌드 명령은 [CLAUDE.md](../../CLAUDE.md) 참조. 윈컴 빌드는 메모리 [project_win_remote_build_ssh].

## Mac 빌드 환경

### 설치된 도구

| 도구 | 버전 | 위치 |
|------|------|------|
| Rust (default) | 1.81 | `~/.cargo` |
| Rust (stable) | 1.95 | `~/.cargo` |
| Flutter (RustDesk용) | 3.24.5 | `~/flutter-3.24.5` |
| Flutter (기타) | 3.41.8 | `/opt/homebrew/bin/flutter` |
| vcpkg + libs (vpx/yuv/opus/aom) | latest | `~/vcpkg` |
| NASM | 2.16.03 | `~/.local/bin/nasm` |
| flutter_rust_bridge_codegen | 1.80.1 | `~/.cargo/bin` |
| Xcode | 26.2 | `/Applications/Xcode.app` |
| CocoaPods | 1.16.2 | brew |
| llvm, create-dmg, pkg-config | latest | brew |

### Flutter 패치 (필수)

RustDesk가 Flutter 3.24.5의 issue #133533을 회피하기 위해 패치 적용됨:
```bash
sed -i '' 's|_setFramesEnabledState(false);|//_setFramesEnabledState(false);|g' \
  ~/flutter-3.24.5/packages/flutter/lib/src/scheduler/binding.dart
```
Flutter SDK 재설치 시 다시 적용 필요.

---

## Mac 빌드 함정 8 — `.dart_tool` 의 homebrew Flutter SDK 누수 (2026-05-20)

- **증상**: PATH 에 `~/flutter-3.24.5/bin` 박았는데도 빌드 도중 `/opt/homebrew/share/flutter/packages/flutter/...:engineId` 에러로 실패.
- **원인**: `flutter/.dart_tool/package_config.json` 의 `flutter` 패키지 rootUri 가 과거 brew Flutter 3.41.8 로 pub get 한 흔적 박힘. PATH 1순위라도 캐시가 우선.
- **픽스**: 빌드 전 `rm -rf flutter/.dart_tool` 한 줄 추가 후 `flutter pub get` 재실행.

## Mac 빌드 함정 9 — `flutter_rust_bridge_codegen` 이 `.dart_tool` 을 brew SDK 로 오염 (2026-05-20)

- **증상**: 함정 8 픽스 직후 `flutter pub get` 으로 package_config.json 을 우리 SDK 로 박았음에도, codegen 한 번 돌리면 brew Flutter 로 다시 바뀜.
- **픽스**: 빌드 워크플로에서 codegen 직후에도 `rm -rf flutter/.dart_tool && flutter pub get` 박을 것.

## Mac 빌드 함정 10 — `http_request_sync` 의 헤더 형식 + 응답 wrapper (2026-05-20)

RustDesk 의 두 HTTP 헬퍼가 서로 다른 헤더 형식을 요구.

| 함수 | 헤더 입력 형식 | 응답 형식 |
|---|---|---|
| `post_request_sync` (common.rs:1494) | `"Name: value"` 단순 split | raw body 문자열 |
| `http_request_sync` (common.rs:1648) | **JSON object** `{"Name":"value"}` | **wrapper** `{"body":"<json string>"}` |

**정석 패턴**:
```rust
let header = format!(r#"{{"Authorization":"Bearer {}"}}"#, token);
let raw = crate::http_request_sync(url, "GET".into(), None, header)?;
let inner = serde_json::from_str::<HttpWrapper>(&raw).map(|w| w.body).unwrap_or(raw);
let parsed: MyType = serde_json::from_str(&inner)?;
```
`HttpWrapper { body: String }` 같은 wrapper 구조체 필수. body 가 stringified JSON 이므로 두 단계 파싱.

## Mac 빌드 함정 11 — Flutter incremental 이 dart kernel 재컴파일을 skip (2026-05-20)

- **증상**: dart 파일 수정했는데 빌드 후 옛 UI 그대로. binary grep 으로 새 string 안 잡힘.
- **확인 방법**: `stat -f "%Sm" flutter/build/macos/Build/Products/Release/ChainRemote.app/Contents/Frameworks/App.framework/Versions/A/App` 의 mtime vs 소스 mtime.
- **원인**: Flutter assemble 의 dart kernel snapshot 단계가 `.dart_tool/flutter_build/...stamp` 기반 incremental 판단.
- **픽스**: `cd flutter && flutter clean && rm -rf .dart_tool build && flutter pub get` 후 재빌드.

## Mac 빌드 함정 12 — `export` 필수 (2026-05-22)

- **증상**: 옛 명령은 `PATH=... VCPKG_ROOT=... bash -c '...'` 형태라 env 가 그 `bash -c` 한 줄에만 적용. 그 뒤 `&& python3 ./build.py` 는 env 없이 기본 PATH 로 실행 → `build.py` 가 brew Flutter 3.41.8 잡아 빌드 실패.
- **픽스**: 반드시 `export` 로 셸 전체에 전파. 빌드 시작 직후 `which flutter` 가 `~/flutter-3.24.5/bin/flutter` 인지 확인.

---

## 왜 `/Applications/ChainRemote.app` 까지 복사하는가 (2026-05-20)

- `build/macos/Build/Products/Release/ChainRemote.app` 가 새 빌드, `/Applications/ChainRemote.app` 가 매일 켜는 것 (Spotlight·Dock). 둘은 다른 파일.
- build dir 빌드만 갱신하고 `open` 하면 새 코드 검증 가능. 단 Chang/재성이가 평소 Launchpad 로 켜는 건 옛 .app → "코드 적용 안 됨" 착각.
- 빌드 워크플로에 `/Applications` 복사 + 재서명까지 포함해야 두 vector 일치.

**Phase 3-Mac (2026-05-25)**: `PRODUCT_NAME = ChainRemote` + Bundle ID `com.betaposlab.chainremote`. 빌드 출력이 `RustDesk.app` 에서 `ChainRemote.app` 으로 변경됨. macOS 가 새 bundle id 를 다른 앱으로 인식하므로 화면 기록/입력 모니터링/접근성 권한 재승인 필요 (첫 실행 시 OS 다이얼로그).

---

## Next.js 16 함정 — middleware.ts → proxy.ts 이름 변경 (2026-05-20)

- **증상**: 패널의 `middleware.ts` matcher 가 `/api/*` 제외했는데도 Bearer 요청이 NextAuth 쿠키 미들웨어 307 리디렉트 → `/login?next=...`.
- **원인**: Next 16 부터 `middleware.ts` → `proxy.ts` 로 이름 변경.
- **픽스**: 파일명 `proxy.ts` 로 변경 + 내부에 이중 안전망 `if (req.nextUrl.pathname.startsWith("/api")) return NextResponse.next();`.

## TLS 함정 — RustDesk reqwest/rustls + Synology nginx 호환 (2026-05-20)

- **증상**: `curl https://sepani.synology.me:3443/api/customers` 는 통과. 같은 URL 을 Mac 본사 앱이 호출하면 `peer closed connection without sending TLS close_notify` (rustls) → `Error -9806` (native-tls fallback) → 둘 다 실패.
- **원인**: rustls 와 Synology DSM 의 nginx 가 TLS 1.3 close_notify 처리에서 호환 불안정.
- **채택한 해결**: HTTPS 포기 + HTTP 3001 직노출. Chang 의 보안 의지(낮음)와 정합.
- **향후 HTTPS 가 필요해지면**: Cloudflare Tunnel 또는 별도 nginx 컨테이너(certbot) 로 TLS termination 우회.

---

## 알려진 이슈/생략된 옵션

- **`--hwcodec` 생략됨**: ffmpeg 컴파일 30~60분 소요. 필요해지면 `vcpkg install ffmpeg` 후 추가.
- **ad-hoc 서명**: 개발용. 배포 시 Apple Developer 인증서로 정식 서명 + notarization 필요.
- **git submodule**: `libs/hbb_common` 첫 클론 시 빠짐 → `git submodule update --init --recursive` 필수.
