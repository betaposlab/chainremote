export type IssueType =
  | "config"
  | "hardware"
  | "software"
  | "network"
  | "training"
  | "other";
export type Resolution = "resolved" | "pending" | "escalated" | "in_progress";

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  config: "설정",
  hardware: "고장 (HW)",
  software: "SW 오류",
  network: "네트워크",
  training: "사용 안내",
  other: "기타",
};

export const RESOLUTION_LABELS: Record<Resolution, string> = {
  resolved: "해결",
  pending: "보류",
  escalated: "재방문 필요",
  in_progress: "진행 중",
};

// A/S 종류(categories) 코드 → 한글. HQ 종료 모달이 쓰는 목록과 같은 값이어야 한다
//   (flutter/lib/common/widgets/chainremote_session_record.dart 의 kCrCategories).
//   HQ 가 콤마로 이어 보낸 코드를 패널에서 사람이 읽는 말로 되돌리는 용도.
export const CATEGORY_LABELS: Record<string, string> = {
  menu: "메뉴/상품",
  table: "테이블/주문",
  payment: "결제/VAN",
  printer: "프린터/출력",
  peripheral: "주변장치",
  system: "시스템/OS",
  network: "네트워크",
  program: "프로그램/업데이트",
  data: "데이터/정산",
  setup: "설치/셋업",
  howto: "사용법 문의",
  etc: "기타",
};
