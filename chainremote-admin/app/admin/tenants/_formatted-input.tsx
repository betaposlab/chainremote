"use client";

// 한국 번호 자동 하이픈 입력. 숫자만 쭉 쳐도 표시는 하이픈이 들어간 꼴로 나온다.
// 입력 중에는 되는 데까지 부분 포맷, 자릿수가 차면 완전한 하이픈.
//
// 지원 포맷:
//   businessNo: XXX-XX-XXXXX (10자리)
//   phone(자동 감지):
//     02 (서울)    02-XXX-XXXX(9) | 02-XXXX-XXXX(10)
//     0XX (지방)   0XX-XXX-XXXX(10) | 0XX-XXXX-XXXX(11)
//     휴대폰 01[016789]  0XX-XXXX-XXXX(11) | 0XX-XXX-XXXX(10, 옛 번호)
//     070 (인터넷) 070-XXXX-XXXX(11)
//     050X (평생)  050X-XXXX-XXXX(12)

import { useState } from "react";

export type FormatType = "businessNo" | "phone";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  type: FormatType;
  name: string;
  defaultValue?: string;
};

export function FormattedInput({ type, name, defaultValue, ...rest }: Props) {
  const [value, setValue] = useState<string>(() => format(type, defaultValue ?? ""));
  return (
    <input
      {...rest}
      name={name}
      type="tel"
      inputMode="numeric"
      value={value}
      onChange={(e) => setValue(format(type, e.target.value))}
      maxLength={type === "businessNo" ? 12 : 13}
    />
  );
}

export function format(type: FormatType, raw: string): string {
  if (type === "businessNo") return formatBusinessNo(raw);
  return formatKoreanPhone(raw);
}

function formatBusinessNo(raw: string): string {
  const d = digitsOnly(raw).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function formatKoreanPhone(raw: string): string {
  const d = digitsOnly(raw).slice(0, 12);
  if (d.length === 0) return "";

  // 서울 02 — 지역번호 2자리
  if (d.startsWith("02")) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `02-${d.slice(2)}`;
    if (d.length <= 9) return `02-${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
    // 10자리: 02-XXXX-XXXX
    return `02-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }

  // 휴대폰 010/011/016/017/018/019 — 3자리 prefix
  if (/^01[016789]/.test(d)) {
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length === 10) {
      // 옛 휴대폰 (011 등) 0XX-XXX-XXXX
      return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    }
    // 11자리: 010-XXXX-XXXX
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
  }

  // 070 (인터넷전화)
  if (d.startsWith("070")) {
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
  }

  // 050X (평생번호) — 4자리 prefix
  if (/^050\d/.test(d)) {
    if (d.length <= 4) return d;
    if (d.length <= 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
    return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8, 12)}`;
  }

  // 지방 0XX (031~064 등) — 3자리 지역번호
  if (/^0\d{2}/.test(d)) {
    const area = d.slice(0, 3);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${area}-${d.slice(3)}`;
    if (d.length === 10) return `${area}-${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 11) return `${area}-${d.slice(3, 7)}-${d.slice(7)}`;
    // 중간 입력: 적절 분리
    return `${area}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
  }

  // 알 수 없는 형식: 숫자 그대로
  return d;
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}
