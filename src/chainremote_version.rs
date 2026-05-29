// ChainRemote 자체 버전 — 인스톨러/UI 표시/자동 업데이트 비교 대상.
// agent-installer.iss / hq-installer.iss 의 APP_VERSION 과 항상 동기화.
//
// 별도 파일로 분리한 이유: src/version.rs 는 빌드 시 자동 생성되는 파일(.gitignore 등록됨)이라
// 직접 편집해도 윈컴 빌드 사이클에서 덮어써짐. 본 파일은 git tracked 라 안전.
pub const CHAINREMOTE_VERSION: &str = "1.3.6";
