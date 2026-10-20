// 알려진 감염 흔적 칩(마이그 061) — 운영자 화면에만 그린다(호출 측이 거른다).
//   흔적이 하나라도 있으면 빨간 "감염 의심". 마우스를 올리면 무엇이 보였는지와 점검 시각이 뜬다.
//   ★단정하지 않는다: 이 칩은 "알려진 흔적이 보였다"는 뜻이지 진단이 아니다.
import { infectLabels } from "@/lib/infect-signs";

export function InfectChip({ signs, checkedAt }: { signs: string | null; checkedAt: Date | null }) {
  const labels = infectLabels(signs);
  if (labels.length === 0) return null;
  const when = checkedAt
    ? checkedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })
    : "알 수 없음";
  const title = `알려진 감염 흔적(운영자에게만 보임)\n- ${labels.join("\n- ")}\n점검: ${when}`;
  return (
    <span className="ml-2 inline-block chip chip-danger" title={title}>
      감염 의심
    </span>
  );
}
