// 알려진 감염 흔적(마이그 061) — 코드와 화면 문구의 단일 출처.
//
// ★DB 를 import 하지 않는다. 화면 컴포넌트가 이 파일을 가져가는데, lib/data 를 거치면 pg 가
//   브라우저 번들로 끌려간다(2026-08 문의함 배포 사고).
//
// 코드는 에이전트 src/chainremote_infect_check.rs 의 ORDER 와 같아야 한다.

export const INFECT_CODES = ["launch", "wdext", "mscaps", "wtime32", "runkey", "selfappend"] as const;
export type InfectCode = (typeof INFECT_CODES)[number];

const LABELS: Record<InfectCode, string> = {
  launch: "침입 파일 launch.exe (사용자 폴더 Microsoft\\Defender)",
  wdext: "침입 파일 WdExt.exe (Microsoft\\Messenger\\Extension)",
  mscaps: "침입 파일 mscaps.exe (Microsoft\\Protect\\SETUP)",
  wtime32: "시스템 폴더의 wtime32.dll",
  runkey: "시작 프로그램 등록 (Windows Defender Extension 등)",
  selfappend: "체인리모트 실행파일 뒤에 무언가 덧붙음",
};

/** 에이전트가 보낸 목록에서 아는 코드만 남긴다(중복 제거, 고정 순서). 깨끗하면 "". */
export function sanitizeInfectSigns(raw: string): string {
  const got = new Set(
    raw
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
  return INFECT_CODES.filter((c) => got.has(c)).join(",");
}

/** 화면에 띄울 한 줄씩의 설명. 모르는 코드는 버린다. */
export function infectLabels(signs: string | null | undefined): string[] {
  if (!signs) return [];
  return sanitizeInfectSigns(signs)
    .split(",")
    .filter(Boolean)
    .map((c) => LABELS[c as InfectCode]);
}
