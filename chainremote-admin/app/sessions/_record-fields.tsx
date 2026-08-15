"use client";

// 지원기록 내용 입력칸 — [기록 편집]과 [기록 추가]가 같은 폼을 쓴다.
//   장애 유형·해결 여부·응대자·A/S 종류(체크박스, HQ 와 같은 코드)·내용.
//   시간은 여기 없다 — 원격 시간은 사실 기록이라 편집 대상이 아니고, 수동 기록만 따로 받는다.

import {
  CATEGORY_LABELS,
  ISSUE_TYPE_LABELS,
  RESOLUTION_LABELS,
  type IssueType,
  type Resolution,
} from "@/lib/session-labels";

export type RecordDefaults = {
  issueType?: IssueType | null;
  resolution?: Resolution | null;
  contactName?: string | null;
  categories?: string | null;
  description?: string | null;
};

export function RecordFields({
  defaults,
  descriptionRequired,
}: {
  defaults?: RecordDefaults;
  descriptionRequired?: boolean;
}) {
  const cats = new Set(
    (defaults?.categories ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="block text-xs text-[#ccd2e3] mb-1">장애 유형</span>
          <select name="issueType" defaultValue={defaults?.issueType ?? ""} className="input">
            <option value="">-</option>
            {(Object.keys(ISSUE_TYPE_LABELS) as IssueType[]).map((k) => (
              <option key={k} value={k}>
                {ISSUE_TYPE_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-[#ccd2e3] mb-1">해결 여부</span>
          <select
            name="resolution"
            defaultValue={defaults?.resolution ?? "resolved"}
            className="input"
          >
            {(Object.keys(RESOLUTION_LABELS) as Resolution[]).map((k) => (
              <option key={k} value={k}>
                {RESOLUTION_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-[#ccd2e3] mb-1">거래처 응대자</span>
          <input
            name="contactName"
            defaultValue={defaults?.contactName ?? ""}
            placeholder="김점장"
            className="input"
          />
        </label>
      </div>

      <div>
        <div className="text-xs text-[#ccd2e3] mb-1">A/S 종류</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {Object.entries(CATEGORY_LABELS).map(([code, label]) => (
            <label key={code} className="inline-flex items-center gap-1 text-xs text-[#eef1f7]">
              <input
                type="checkbox"
                name="categories"
                value={code}
                defaultChecked={cats.has(code)}
                className="accent-[#4C7DFF]"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="block text-xs text-[#ccd2e3] mb-1">
          지원 내용{descriptionRequired ? " (필수)" : ""}
        </span>
        <textarea
          name="description"
          rows={4}
          required={descriptionRequired}
          defaultValue={defaults?.description ?? ""}
          placeholder="영수증 프린터 IP 재설정 / 윈도우 업데이트 후 드라이버 재설치"
          className="input"
        />
      </label>
    </div>
  );
}
