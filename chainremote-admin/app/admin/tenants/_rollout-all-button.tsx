"use client";

// super_admin(Chang) 전용 "전 대리점 에이전트 롤아웃" 버튼. 발행된 버전(agent-push.json)을
// 자동 확인하고 확인 한 번으로 전 활성 대리점에 일괄 푸시한다. 각 POS 는 설치 시간대 +
// 무작위 분산 + 세션보류 + sha검증(에이전트 측 기존 가드)으로 알아서 안전하게 적용한다.
// blast-radius 를 통제하려고 Chang 의 명시 클릭 한 번을 게이트로 뒀다.

import { useState, useTransition } from "react";
import { rolloutAllTenantsAction } from "@/lib/actions/push";

const AGENT_PUSH_META_URL = "/api/agent-push-meta";

type Meta = { version: string; url: string; sha256: string; size: number };

type RolloutResult = {
  tenants: {
    tenantId: string;
    displayName: string;
    inserted: number;
    eligible: number;
    error?: string;
  }[];
  tenantCount: number;
  totalInserted: number;
  totalEligible: number;
};

async function fetchMeta(): Promise<Meta | null> {
  try {
    const resp = await fetch(AGENT_PUSH_META_URL, { cache: "no-store" });
    if (!resp.ok) return null;
    const j = (await resp.json()) as Record<string, unknown>;
    const version = typeof j.version === "string" ? j.version : "";
    const url = typeof j.url === "string" ? j.url : "";
    const sha256 = typeof j.sha256 === "string" ? j.sha256 : "";
    const size = typeof j.size === "number" ? j.size : 0;
    if (!version || !url || sha256.length !== 64 || size <= 0) return null;
    return { version, url, sha256, size };
  } catch {
    return null;
  }
}

export function RolloutAllButton() {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [windowStart, setWindowStart] = useState("0");
  const [windowEnd, setWindowEnd] = useState("23");
  const [randomize, setRandomize] = useState("600");
  const [result, setResult] = useState<RolloutResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const openDialog = async () => {
    setOpen(true);
    setMeta(null);
    setMetaErr(null);
    setResult(null);
    setErr(null);
    setLoadingMeta(true);
    const m = await fetchMeta();
    setLoadingMeta(false);
    if (m) setMeta(m);
    else setMetaErr("agent-push.json 을 못 가져왔습니다 — NAS 에 에이전트 버전을 먼저 발행하세요.");
  };

  const submit = () => {
    if (!meta) return;
    const ws = Number(windowStart);
    const we = Number(windowEnd);
    const rz = Number(randomize);
    if (!Number.isInteger(ws) || ws < 0 || ws > 23 || !Number.isInteger(we) || we < 0 || we > 23) {
      setErr("설치 시간대는 0~23 정수여야 합니다.");
      return;
    }
    if (!Number.isFinite(rz) || rz < 0) {
      setErr("무작위 분산(초)이 유효하지 않습니다.");
      return;
    }
    setErr(null);
    const fd = new FormData();
    fd.set("targetVersion", meta.version);
    fd.set("assetUrl", meta.url);
    fd.set("assetSha256", meta.sha256);
    fd.set("assetSize", String(meta.size));
    fd.set("windowStartHour", String(ws));
    fd.set("windowEndHour", String(we));
    fd.set("randomizeMaxSec", String(rz));
    startTransition(async () => {
      try {
        const r = await rolloutAllTenantsAction(fd);
        setResult(r);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="rounded-md border border-[#00A0E5] text-[#00A0E5] hover:bg-[#00A0E5]/10 px-4 py-2 text-sm font-medium"
        title="발행된 에이전트 버전을 전 활성 대리점에 일괄 롤아웃"
      >
        ⬆ 전 대리점 에이전트 롤아웃
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 p-4 flex items-start justify-center overflow-y-auto">
          <div className="mt-12 w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <header className="border-b border-slate-200 px-5 py-3">
              <h2 className="text-lg font-semibold">전 대리점 에이전트 롤아웃</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                활성 대리점 전체의 모든 거래처 POS 에 한 번에 푸시. 각 POS 는 설치 시간대 +
                무작위 분산 + 원격세션 보류 + sha 검증으로 알아서 안전 적용합니다.
              </p>
            </header>
            <div className="px-5 py-4 space-y-3">
              {loadingMeta && (
                <p className="text-sm text-slate-500">발행된 에이전트 버전 확인 중...</p>
              )}
              {metaErr && (
                <div className="rounded bg-amber-50 text-amber-800 text-sm px-3 py-2">{metaErr}</div>
              )}
              {meta && (
                <>
                  <div className="rounded bg-slate-50 px-3 py-2 text-sm">
                    롤아웃 버전:{" "}
                    <span className="font-mono font-semibold">v{meta.version}</span>
                    <div className="text-xs text-slate-400 font-mono break-all mt-1">
                      {meta.url}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="시작 시간">
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={windowStart}
                        onChange={(e) => setWindowStart(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </Field>
                    <Field label="종료 시간">
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={windowEnd}
                        onChange={(e) => setWindowEnd(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </Field>
                    <Field label="분산(초)" hint="기본 600=10분">
                      <input
                        type="number"
                        min={0}
                        value={randomize}
                        onChange={(e) => setRandomize(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </Field>
                  </div>
                  <p className="text-xs text-slate-400">
                    설치 시간대 0~23 = 켜져 있을 때 언제든 적용(POS 야간 전원 OFF 대응). 분산(초)은
                    각 POS 가 0~분산초 사이 무작위 시점에 받음(NAS 대역폭 보호). 기본 600=10분(지금
                    규모 적합) — 수백~수천 거래처 동시 롤아웃이면 크게(예: 21600=6h).
                  </p>
                </>
              )}
              {err && (
                <div className="rounded bg-red-50 text-red-700 text-sm px-3 py-2">{err}</div>
              )}
              {result && (
                <div className="rounded bg-emerald-50 text-emerald-800 text-sm px-3 py-2 space-y-1">
                  <div className="font-medium">
                    ✓ {result.tenantCount}개 대리점 롤아웃 — 신규 {result.totalInserted}행 / 대상{" "}
                    {result.totalEligible} POS.
                  </div>
                  {result.tenants.map((t) => (
                    <div key={t.tenantId} className="text-xs">
                      · {t.displayName}:{" "}
                      {t.error ? (
                        <span className="text-red-600">실패 — {t.error}</span>
                      ) : (
                        `신규 ${t.inserted} / 대상 ${t.eligible}`
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <footer className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="rounded border border-slate-300 hover:bg-slate-50 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={isPending || !meta || !!result}
                className="rounded bg-[#00A0E5] hover:bg-[#0090d0] text-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {isPending ? "롤아웃 중..." : "전 대리점 롤아웃 시작"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}
        {hint && <span className="font-normal text-slate-400 ml-1">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}
