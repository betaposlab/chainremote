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

export function vanLabel(kind: string | null): string {
  if (!kind) return "";
  return VAN_KINDS.find((v) => v.kind === kind)?.label ?? kind;
}
