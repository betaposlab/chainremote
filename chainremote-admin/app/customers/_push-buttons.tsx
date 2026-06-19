"use client";

// 푸시 버튼 + 다이얼로그. 거래처 표의 행별 [푸시] 버튼 (개별) 과 상단 [일괄 푸시] 버튼.
//
// 다이얼로그에 직접 입력: targetVersion / assetUrl / assetSha256 / assetSize.
// 설치 허용 시간대: 기본 0~23(하루 종일). 거래처는 퇴근 시 PC 를 꺼서 새벽(0~7)과 안 겹침
//   → 하루 종일로 둬야 출근 후 켜진 시점에 적용됨. 24h 켜진 PC 만 0~7(새벽) 권장.
// 무작위지연: 10분(600초) default (2026-06-20, 7h→10분) — 소규모 즉시성 우선. 수백~수천대 푸시 시
//   NAS 대역폭 분산 위해 늘릴 것. 일괄푸시는 직전에 옛 대기 자동취소(pushBulk) → 항상 최신 1건만.
//
// 자동 fetch: NAS 의 `agent-push.json` (별도 메타 파일) 에서 sha256/URL/size 자동 채움.
// 옛 latest.json 의 agent 채널은 옛 v1.3.4 Agent 호환 위해 0.0.0 영구 유지.
// agent-push.json 은 v1.3.6+ 패널에서만 fetch — 옛 Agent 안 봄.

import { useState, useTransition } from "react";

// 같은 출처(패널) 프록시 라우트 호출 → 브라우저 CORS 회피.
// 실제 NAS agent-push.json fetch 는 서버사이드(app/api/agent-push-meta)에서 수행.
const AGENT_PUSH_META_URL = "/api/agent-push-meta";

async function fetchAgentPushMeta(): Promise<
  | {
      version: string;
      url: string;
      sha256: string;
      size: number;
    }
  | null
> {
  try {
    const resp = await fetch(AGENT_PUSH_META_URL, { cache: "no-store" });
    if (!resp.ok) return null;
    const j = (await resp.json()) as Record<string, unknown>;
    const version = typeof j.version === "string" ? j.version : "";
    const url = typeof j.url === "string" ? j.url : "";
    const sha256 = typeof j.sha256 === "string" ? j.sha256 : "";
    const size = typeof j.size === "number" ? j.size : 0;
    if (!version || !url || !sha256 || size <= 0) return null;
    return { version, url, sha256, size };
  } catch {
    return null;
  }
}
import {
  pushToCustomerAction,
  pushBulkAction,
  cancelPushAction,
} from "@/lib/actions/push";

type PendingMeta = {
  id: string;
  targetVersion: string;
  bulkBatchId: string | null;
  createdAt: Date | string;
} | null;

interface PushFormState {
  targetVersion: string;
  assetUrl: string;
  assetSha256: string;
  assetSize: string;
  windowStartHour: string;
  windowEndHour: string;
  randomizeMaxSec: string;
}

const INITIAL: PushFormState = {
  targetVersion: "",
  assetUrl: "",
  assetSha256: "",
  assetSize: "",
  windowStartHour: "0",
  windowEndHour: "23",
  randomizeMaxSec: "600",
};

function buildFormData(state: PushFormState): FormData {
  const fd = new FormData();
  fd.set("targetVersion", state.targetVersion.trim());
  fd.set("assetUrl", state.assetUrl.trim());
  fd.set("assetSha256", state.assetSha256.trim());
  fd.set("assetSize", state.assetSize.trim());
  fd.set("windowStartHour", state.windowStartHour);
  fd.set("windowEndHour", state.windowEndHour);
  fd.set("randomizeMaxSec", state.randomizeMaxSec);
  return fd;
}

function validate(state: PushFormState): string | null {
  if (!state.targetVersion.trim()) return "타겟 버전 필수 (예: 1.3.5)";
  if (!state.assetUrl.trim()) return "asset URL 필수";
  if (!state.assetSha256.trim() || state.assetSha256.trim().length !== 64) {
    return "sha256 은 64자 hex 여야 함";
  }
  const size = Number(state.assetSize);
  if (!Number.isFinite(size) || size <= 0) return "asset size 가 유효하지 않음";
  const ws = Number(state.windowStartHour);
  const we = Number(state.windowEndHour);
  if (!Number.isInteger(ws) || ws < 0 || ws > 23) return "시작 시간 0~23";
  if (!Number.isInteger(we) || we < 0 || we > 23) return "종료 시간 0~23";
  return null;
}

/** 거래처 표 행별 [푸시] 버튼 + 다이얼로그. */
export function CustomerPushButton({
  customerId,
  customerName,
  currentVersion,
  pending,
}: {
  customerId: string;
  customerName: string;
  currentVersion: string | null;
  pending: PendingMeta;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PushFormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 이미 대기 중인 경우 = [대기 중 v1.x.x · 취소] 버튼.
  if (pending) {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(`${customerName} 의 v${pending.targetVersion} 푸시를 취소합니다.`)) return;
          startTransition(async () => {
            await cancelPushAction(pending.id);
          });
        }}
        className="inline-flex items-center gap-1 rounded bg-amber-50 text-amber-700 text-xs px-2 py-1 hover:bg-amber-100 disabled:opacity-50"
        title={`대기 중 v${pending.targetVersion} (${new Date(pending.createdAt).toLocaleString("ko-KR")})`}
      >
        ⏳ 대기 v{pending.targetVersion}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setState(INITIAL);
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center text-xs text-slate-500 hover:text-[#00A0E5] px-2 py-1.5"
        title={currentVersion ? `현재 v${currentVersion}` : "버전 미보고"}
      >
        ⬆ 푸시
      </button>
      {open && (
        <PushDialog
          title={`${customerName} 푸시`}
          subtitle={currentVersion ? `현재 v${currentVersion}` : "버전 미보고"}
          state={state}
          setState={setState}
          error={error}
          submitting={isPending}
          onCancel={() => setOpen(false)}
          onSubmit={() => {
            const err = validate(state);
            if (err) {
              setError(err);
              return;
            }
            setError(null);
            startTransition(async () => {
              const result = await pushToCustomerAction(customerId, buildFormData(state));
              if (result.alreadyQueued) {
                setError("이미 대기 중인 푸시가 있습니다 — 표 새로고침 후 확인.");
                return;
              }
              setOpen(false);
            });
          }}
        />
      )}
    </>
  );
}

/** 거래처 표 상단의 [일괄 푸시] 버튼 + 다이얼로그. */
export function BulkPushButton() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PushFormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; eligible: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setState(INITIAL);
          setError(null);
          setResult(null);
          setOpen(true);
        }}
        className="rounded-lg border border-[#00A0E5] text-[#00A0E5] hover:bg-[#00A0E5]/10 px-4 py-2 text-sm font-medium"
      >
        ⬆ 전체 일괄 푸시
      </button>
      {open && (
        <PushDialog
          title="전체 거래처 일괄 푸시"
          subtitle="활성 거래처 전체 (영업시간 가드 + 무작위지연 자동 분산)"
          state={state}
          setState={setState}
          error={error}
          submitting={isPending}
          extraTail={
            result ? (
              <div className="mt-3 rounded bg-emerald-50 text-emerald-800 text-sm px-3 py-2">
                ✓ 일괄 푸시 등록됨 — 신규 {result.inserted} 행 / 대상 {result.eligible} 거래처.
                {result.inserted < result.eligible &&
                  ` ${result.eligible - result.inserted} 거래처는 이미 대기 중이라 skip.`}
              </div>
            ) : null
          }
          onCancel={() => setOpen(false)}
          onSubmit={() => {
            const err = validate(state);
            if (err) {
              setError(err);
              return;
            }
            setError(null);
            startTransition(async () => {
              const r = await pushBulkAction(buildFormData(state));
              setResult({ inserted: r.inserted, eligible: r.eligible });
              // 다이얼로그는 열어둠 → 사용자가 결과 확인 후 닫음.
            });
          }}
          submitLabel="일괄 푸시 시작"
        />
      )}
    </>
  );
}

function PushDialog({
  title,
  subtitle,
  state,
  setState,
  error,
  submitting,
  onCancel,
  onSubmit,
  submitLabel = "푸시 등록",
  extraTail,
}: {
  title: string;
  subtitle: string;
  state: PushFormState;
  setState: (s: PushFormState) => void;
  error: string | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  extraTail?: React.ReactNode;
}) {
  const set = <K extends keyof PushFormState>(k: K, v: string) =>
    setState({ ...state, [k]: v });

  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);

  const handleAutoFill = async () => {
    setFetching(true);
    setFetchMsg(null);
    const meta = await fetchAgentPushMeta();
    setFetching(false);
    if (!meta) {
      setFetchMsg("agent-push.json 못 가져옴 (NAS 미배포 또는 형식 오류)");
      return;
    }
    setState({
      ...state,
      targetVersion: meta.version,
      assetUrl: meta.url,
      assetSha256: meta.sha256,
      assetSize: String(meta.size),
    });
    setFetchMsg(`✓ v${meta.version} 자동 채움 완료`);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 p-4 flex items-start justify-center overflow-y-auto">
      <div className="mt-12 w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <header className="border-b border-slate-200 px-5 py-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={handleAutoFill}
            disabled={fetching}
            className="shrink-0 rounded border border-[#00A0E5] text-[#00A0E5] hover:bg-[#00A0E5]/10 text-xs px-2 py-1 disabled:opacity-50"
            title="NAS agent-push.json 에서 최신 메타 가져오기"
          >
            {fetching ? "가져오는 중..." : "⤓ 최신 가져오기"}
          </button>
        </header>
        {fetchMsg && (
          <div className={`px-5 pt-3 text-xs ${fetchMsg.startsWith("✓") ? "text-emerald-700" : "text-amber-700"}`}>
            {fetchMsg}
          </div>
        )}
        <div className="px-5 py-4 space-y-3">
          <Field label="타겟 버전" hint="예: 1.3.5">
            <input
              type="text"
              value={state.targetVersion}
              onChange={(e) => set("targetVersion", e.target.value)}
              placeholder="1.3.5"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
            />
          </Field>
          <Field label=".exe URL" hint="NAS 또는 외부 호스팅의 직접 다운로드 URL">
            <input
              type="text"
              value={state.assetUrl}
              onChange={(e) => set("assetUrl", e.target.value)}
              placeholder="https://sepani.synology.me/chainremote/ChainRemote_Agent_Setup_v1.3.5.exe"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
            />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="sha256" hint="64자 hex" colSpan={2}>
              <input
                type="text"
                value={state.assetSha256}
                onChange={(e) => set("assetSha256", e.target.value)}
                placeholder="abc123..."
                className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-mono"
              />
            </Field>
            <Field label="크기 (bytes)">
              <input
                type="number"
                value={state.assetSize}
                onChange={(e) => set("assetSize", e.target.value)}
                placeholder="12345678"
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono"
              />
            </Field>
          </div>
          <div className="border-t border-slate-200 pt-3 mt-3">
            <p className="text-xs text-slate-500 mb-2">
              설치 허용 시간대 (시 단위, 24h). 기본 0~23 = 하루 종일(퇴근 시 끄는 거래처 권장). 24h 켜진 PC 만 0~7.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="시작 시간">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={state.windowStartHour}
                  onChange={(e) => set("windowStartHour", e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </Field>
              <Field label="종료 시간">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={state.windowEndHour}
                  onChange={(e) => set("windowEndHour", e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </Field>
              <Field label="무작위지연 (초)" hint="기본 600 = 10분">
                <input
                  type="number"
                  min={0}
                  value={state.randomizeMaxSec}
                  onChange={(e) => set("randomizeMaxSec", e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </Field>
            </div>
          </div>
          {error && (
            <div className="rounded bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
          )}
          {extraTail}
        </div>
        <footer className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded border border-slate-300 hover:bg-slate-50 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="rounded bg-[#00A0E5] hover:bg-[#0090d0] text-white px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {submitting ? "처리 중..." : submitLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  colSpan,
  children,
}: {
  label: string;
  hint?: string;
  colSpan?: number;
  children: React.ReactNode;
}) {
  return (
    <div className={colSpan === 2 ? "col-span-2" : undefined}>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}
        {hint && <span className="font-normal text-slate-400 ml-1">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}
