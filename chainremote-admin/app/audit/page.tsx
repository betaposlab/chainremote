// 감사 기록 화면 — "누가 언제 무엇을 했나".
//
// 여태 audit_logs 는 쌓이기만 하고 보는 길이 없어, 확인하려면 DB 를 직접 열어야 했다.
// 대리점이 늘면 그 방식은 못 쓴다.
//
// ★권한: super_admin 은 전 회사, owner·admin 은 자기 회사만. member 는 이 화면이 없다.
//   격리는 lib/data/audit-search.ts 에서 강제한다 — 화면이 tenantId 를 빼먹을 수 없게.

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireLiveUser } from "@/lib/auth-guard";
import { canManageAccounts } from "@/lib/roles";
import {
  searchAudit,
  type AuditPeriod,
  type AuditKind,
} from "@/lib/data/audit-search";
import { AuditTable } from "./_audit-table";

export const dynamic = "force-dynamic";

const PERIODS: { key: AuditPeriod; label: string }[] = [
  { key: "week", label: "최근 7일" },
  { key: "month", label: "최근 30일" },
  { key: "quarter", label: "최근 90일" },
  { key: "all", label: "전체" },
];

const KINDS: { key: AuditKind; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "auth", label: "로그인" },
  { key: "change", label: "변경·삭제" },
];

function chip(active: boolean) {
  return [
    "rounded-md border px-3 py-1.5 text-xs font-medium transition",
    active
      ? "border-[#4c7dff] bg-[#4c7dff]/20 text-white"
      : "border-[#566999] bg-[#3d4e7a] text-[#ccd2e3] hover:bg-white/[0.04]",
  ].join(" ");
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; kind?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireLiveUser();
  // 직원(member)은 볼 수 없다. 남의 로그인 시각과 IP 가 보이는 화면이다.
  if (!canManageAccounts(user.role)) redirect("/");

  const isPlatform = user.role === "super_admin";
  const period = (PERIODS.find((p) => p.key === sp.period)?.key ??
    "month") as AuditPeriod;
  const kind = (KINDS.find((k) => k.key === sp.kind)?.key ?? "all") as AuditKind;
  const q = (sp.q ?? "").trim().slice(0, 60);

  const rows = await searchAudit({
    tenantId: isPlatform ? null : user.tenantId,
    period,
    kind,
    q,
  });

  const href = (patch: Record<string, string>) => {
    const u = new URLSearchParams({ period, kind, ...(q ? { q } : {}) });
    for (const [k, v] of Object.entries(patch)) u.set(k, v);
    return `/audit?${u.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">감사 기록</h1>
        <p className="mt-1 text-sm text-[#ccd2e3]">
          {isPlatform
            ? "전 회사의 로그인과 되돌릴 수 없는 변경이 남습니다."
            : "우리 회사의 로그인과 되돌릴 수 없는 변경이 남습니다."}{" "}
          조회는 남지 않습니다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={href({ period: p.key })}
              className={chip(p.key === period)}
            >
              {p.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <Link
              key={k.key}
              href={href({ kind: k.key })}
              className={chip(k.key === kind)}
            >
              {k.label}
            </Link>
          ))}
        </div>
        <form action="/audit" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="period" value={period} />
          <input type="hidden" name="kind" value={kind} />
          <input
            name="q"
            defaultValue={q}
            placeholder="아이디 · 이름 · IP"
            aria-label="감사 기록 검색"
            className="w-56 rounded-md border border-[#566999] bg-[#2b364f] px-3 py-1.5 text-sm placeholder:text-[#8a94ad]"
          />
          <button type="submit" className="btn btn-primary px-3 py-1.5 text-xs">
            검색
          </button>
          {q && (
            <Link
              href={href({ q: "" }).replace(/&?q=[^&]*/, "")}
              className="text-xs text-[#ccd2e3] underline underline-offset-2"
            >
              지우기
            </Link>
          )}
        </form>
      </div>

      <AuditTable rows={rows} showTenant={isPlatform} />

      {/* 최대 300줄만 가져온다. 그 이상이면 기간을 좁히는 게 맞고, 무한 스크롤을 붙여
          수천 줄을 훑게 만들 자리가 아니다. 잘렸다는 사실은 숨기지 않는다. */}
      {rows.length >= 300 && (
        <p className="text-xs text-[#ccd2e3]">
          최근 300건만 보여 드립니다. 기간을 좁히거나 검색어를 넣으십시오.
        </p>
      )}
    </div>
  );
}
