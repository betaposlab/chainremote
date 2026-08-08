// 대시보드 "최근 업데이트" 카드.
//
// 대리점이 "내 거래처가 최신인가"를 스스로 판단하려면 최신 버전이 몇인지부터 알아야 한다.
//   종전엔 일괄푸시 화면에서 [최신 가져오기]를 눌러야만 알 수 있었다.
//   여기서는 버전과 함께 "이번에 뭐가 달라졌는지"를 한 줄로 보여 준다.

import Link from "next/link";
import { KIND_LABEL, latestVersions } from "@/lib/data/releases";

function firstLine(s: string | null) {
  if (!s) return "";
  const line = s.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.trim();
}

export async function ReleaseCard() {
  let rows: Awaited<ReturnType<typeof latestVersions>> = [];
  try {
    rows = await latestVersions();
  } catch {
    // 대시보드가 이 카드 하나 때문에 통째로 죽으면 안 된다.
    return null;
  }
  if (rows.length === 0) return null;

  // 거래처가 실제로 쓰는 두 채널만. ChainGo 는 무설치라 버전 관리 대상이 아니다.
  const shown = rows.filter((r) => r.kind === "agent" || r.kind === "hq");
  if (shown.length === 0) return null;

  return (
    <div className="panel-card mb-8 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">최근 업데이트</h2>
        <Link href="/releases" className="text-xs text-[#c3d3ff] hover:underline">
          전체 내역 →
        </Link>
      </div>

      <div className="space-y-3">
        {shown.map((r) => {
          const line = firstLine(r.notes);
          return (
            <div key={r.kind} className="flex flex-wrap items-baseline gap-2">
              <span className="chip chip-neutral shrink-0">
                {KIND_LABEL[r.kind] ?? r.kind}
              </span>
              <span className="font-semibold text-white">v{r.version}</span>
              {line && (
                <span className="min-w-0 flex-1 truncate text-sm text-[#cbd1e0]" title={line}>
                  {line}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-[#ccd2e3]">
        거래처 에이전트는 자동으로 업데이트됩니다. 본사 앱은 실행할 때 스스로 최신으로 올라갑니다.
      </p>
    </div>
  );
}
