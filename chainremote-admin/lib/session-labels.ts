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
