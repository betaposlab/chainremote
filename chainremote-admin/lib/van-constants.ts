// VAN 카드결제 데몬 목록(마이그 036).
//
// 이 파일에 DB 접근을 들이지 말 것 — 클라이언트 컴포넌트가 여기서 상수를 가져가는데,
// lib/data 나 lib/db 를 import 하는 순간 pg 가 브라우저 번들로 딸려 와 빌드가 깨진다
// (tsc·vitest 는 못 잡고 next build 에서야 터진다. 문의함 때 한 번 당했다).
//
// kind 값은 에이전트 src/chainremote_van.rs 의 DAEMONS 와 글자까지 같아야 한다.
// 새 VAN 을 지원하려면 양쪽에 같은 kind 를 추가하면 되고, DB 마이그레이션은 필요 없다.

export const VAN_KINDS = [
  { kind: "ksnet", label: "KSNET", process: "KSCAT.exe", port: 27015 },
] as const;

// 손을 뗀('복구 실패') 뒤에도 영업 중(포스앱 켜짐)이면 10분마다 데몬을 다시 띄우는 에이전트 버전.
//   KSCAT 은 켜진 뒤 약 3분만 스스로 리더기를 찾고 손을 놓아서, 리더기(토스 프론트)를 늦게 켠 매장은
//   누가 다시 띄워 줘야만 산다(2026-11-17 테스트2 실측). 이보다 낮은 에이전트는 세 번 뒤 아주 손을
//   놓으므로 '복구 실패' 안내가 달라야 한다 — 사람이 [서비스 시작]을 눌러야 한다.
export const VAN_SLOW_RETRY_SINCE = "1.4.168";

export function vanLabel(kind: string | null): string {
  if (!kind) return "";
  return VAN_KINDS.find((v) => v.kind === kind)?.label ?? kind;
}
