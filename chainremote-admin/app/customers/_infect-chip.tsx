// 알려진 감염 흔적 표시(마이그 061) — 운영자 화면에만 그린다(호출 측이 거른다).
//   흔적이 하나라도 있으면 작은 회색 "흔적". 마우스를 올리면 무엇이 보였는지와 점검 시각이 뜬다.
//   ★경보가 아니라 참고 기록이다(2026-10-24 Chang): 원인이 우리가 아니고 손쓸 수 있는 것도 없다.
//     그래서 빨간색·"의심" 같은 말을 쓰지 않는다. 기록 자체는 나중에 그 매장에서 일이 생겼을 때 쓴다.
import { infectLabels } from "@/lib/infect-signs";

export function InfectChip({ signs, checkedAt }: { signs: string | null; checkedAt: Date | null }) {
  const labels = infectLabels(signs);
  if (labels.length === 0) return null;
  const when = checkedAt
    ? checkedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })
    : "알 수 없음";
  const title = `알려진 감염 흔적 — 참고 기록(운영자에게만 보임)\n- ${labels.join("\n- ")}\n점검: ${when}`;
  return (
    <span className="ml-2 inline-block chip chip-neutral" title={title}>
      흔적
    </span>
  );
}
