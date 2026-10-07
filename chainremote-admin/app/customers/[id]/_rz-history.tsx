// 접속 경로 이력 카드(마이그 057) — "응답 없음" 구간과 대리 전달 요청을 한 줄 타임라인으로.
// 원격이 안 붙었다는 연락을 받았을 때 "그 시각 PC 가 어떤 상태였고, 요청이 어디까지 갔나"를
// 여기서 바로 가른다. 기록이 없으면 카드 자체를 안 그린다 — 옛 에이전트(1.4.151 전)는
// 상태를 보고하지 않으므로 "기록 없음"이 "문제없음"으로 읽히면 안 된다.

import type { RzHistoryItem } from "@/lib/data/rz-history";

const fmt = (d: Date) =>
  d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const hm = (d: Date) =>
  d.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });

function dur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}

/** 풀림 보고와 마지막 응답 없음 보고 사이가 이보다 벌어지면 그 사이 꺼져 있었다고 본다. */
const GAP_MS = 5 * 60_000;

function NoreplyRow({ e }: { e: Extract<RzHistoryItem, { kind: "noreply" }> }) {
  let tail: string;
  if (!e.endedAt) {
    tail = `계속 중 · 마지막 보고 ${hm(e.lastSeenAt)}`;
  } else if (e.endReason === "replaced") {
    tail = `~ ${hm(e.lastSeenAt)} (${dur(e.lastSeenAt.getTime() - e.at.getTime())}) · 에이전트 재시작으로 새 구간`;
  } else if (e.endedAt.getTime() - e.lastSeenAt.getTime() > GAP_MS) {
    tail = `마지막 보고 ${hm(e.lastSeenAt)} → 풀림 확인 ${fmt(e.endedAt)} · 그 사이 꺼져 있었음`;
  } else {
    tail = `~ ${hm(e.endedAt)} (${dur(e.endedAt.getTime() - e.at.getTime())})`;
  }
  return (
    <li className="flex gap-3">
      <span className="w-24 shrink-0 tabular-nums text-[#9aa3ba]">{fmt(e.at)}</span>
      <span>
        <b className="text-[#ffc46b]">응답 없음</b> <span className="text-[#cbd1e0]">{tail}</span>
      </span>
    </li>
  );
}

function RelayRow({ r }: { r: Extract<RzHistoryItem, { kind: "relay" }> }) {
  const who = r.requestedBy ? ` (${r.requestedBy})` : "";
  let body: React.ReactNode;
  if (r.rejectedReason === "stale") {
    body = (
      <>
        <b className="text-[#ff9a9e]">대리 전달 거절</b>
        <span className="text-[#cbd1e0]"> — 마지막 보고가 15분 넘게 없음(PC 꺼짐 추정)</span>
      </>
    );
  } else if (r.rejectedReason) {
    body = (
      <>
        <b className="text-[#ff9a9e]">대리 전달 거절</b>
        <span className="text-[#cbd1e0]"> — 그때 PC 가 응답 없음 상태가 아니었음(접속 실패 원인이 다른 곳)</span>
      </>
    );
  } else if (r.consumedAt) {
    const s = Math.max(0, Math.round((r.consumedAt.getTime() - r.at.getTime()) / 1000));
    body = (
      <>
        <b className="text-[#8fe3b0]">대리 전달</b>
        <span className="text-[#cbd1e0]"> — 거래처가 {s}초 만에 받아 감</span>
      </>
    );
  } else {
    body = (
      <>
        <b className="text-[#ff9a9e]">대리 전달</b>
        <span className="text-[#cbd1e0]"> — 거래처가 받아 가지 않음</span>
      </>
    );
  }
  return (
    <li className="flex gap-3">
      <span className="w-24 shrink-0 tabular-nums text-[#9aa3ba]">{fmt(r.at)}</span>
      <span>
        {body}
        <span className="text-[#9aa3ba]">{who}</span>
      </span>
    </li>
  );
}

export function RzHistoryCard({ items }: { items: RzHistoryItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-6 rounded-xl border border-[#566999] bg-white/[0.02] p-5">
      <h2 className="text-sm font-semibold text-[#eef1f7]">요청 수신 불가 · 대리 전달 이력 (최근 30일)</h2>
      <p className="mt-1 text-xs text-[#9aa3ba]">
        원격이 안 붙었다는 연락을 받으면 그 시각을 여기서 찾아보세요. 대리 전달은 본사 앱이 접속에
        실패한 뒤 패널을 거쳐 한 번 더 시도한 기록입니다.
      </p>
      <ul className="mt-3 space-y-1.5 text-xs">
        {items.map((it, i) =>
          it.kind === "noreply" ? <NoreplyRow key={i} e={it} /> : <RelayRow key={i} r={it} />,
        )}
      </ul>
    </div>
  );
}
