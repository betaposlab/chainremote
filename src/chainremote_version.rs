// ChainRemote 버전 — 인스톨러/UI/자동업데이트 비교의 기준.
// agent-installer.iss / hq-installer.iss 의 APP_VERSION 과 반드시 같이 올린다.
//
// src/version.rs 가 아니라 별도 파일인 이유: 그쪽은 빌드가 자동 생성(.gitignore)하는
// 파일이라 직접 고쳐봤자 윈컴 빌드에서 덮어써진다. 이 파일은 git tracked 라 안전.
pub const CHAINREMOTE_VERSION: &str = "1.4.75";
