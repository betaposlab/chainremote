// 릴리즈 노트 전체 이력.
//
// 전 대리점이 같은 것을 본다. 우리가 무엇을 언제 고쳤는지는 감출 정보가 아니고,
//   오히려 알려야 "업데이트하니 뭐가 좋아졌냐"는 문의가 준다.

import type { Metadata } from "next";
import { auth } from "@/auth";
import { KIND_LABEL, listReleases } from "@/lib/data/releases";

export const metadata: Metadata = { title: "업데이트 내역 — ChainRemote 관리 패널" };
export const dynamic = "force-dynamic";

function fmt(d: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeZone: "Asia/Seoul",
  }).format(d);
}

export default async function ReleasesPage() {
  const session = await auth();
  if (!session?.user) return null;

  const rows = await listReleases();

  // 날짜별로 묶는다. 한 날 여러 채널이 나가는 일이 잦아(오늘만 다섯 번) 버전별로 나열하면
  //   같은 날 것이 흩어져 읽기 어렵다.
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const day = fmt(r.releasedAt);
    const list = byDay.get(day) ?? [];
    list.push(r);
    byDay.set(day, list);
  }

  return (
    <div className="print-doc px-4 py-5 md:px-8 md:py-6 max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">업데이트 내역</h1>
        <p className="mt-1 text-sm text-[#cbd1e0]">
          ChainRemote 가 어떻게 달라졌는지 기록합니다. 거래처 에이전트는 자동으로 업데이트되며,
          본사 앱은 실행할 때 스스로 최신으로 올라갑니다.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="panel-card p-8 text-center text-sm text-[#cbd1e0]">
          아직 기록된 업데이트가 없습니다.
        </div>
      ) : (
        <div className="space-y-5">
          {[...byDay.entries()].map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-semibold text-[#c3d3ff]">{day}</h2>
              <div className="space-y-2">
                {list.map((r) => (
                  <article key={r.id} className="panel-card p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip chip-neutral">
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </span>
                      <span className="font-semibold text-white">v{r.version}</span>
                    </div>
                    {r.notes && (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#eef1f7]">
                        {r.notes}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
