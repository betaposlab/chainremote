// 문의함 — 대리점은 자기가 낸 것만, 플랫폼 운영자는 전 대리점을 본다.
//
// 게시판이 아닌 이유는 마이그 031 주석에 적어 뒀다. 요지는 대리점끼리 서로의 글을 볼
//   이유가 없고, 상호·업무 사정이 그대로 드러난다는 것이다.

import { auth } from "@/auth";
import { listFeedbackForPlatform, listFeedbackForTenant } from "@/lib/data/feedback";
import {
  KIND_LABEL,
  STATUS_LABEL,
  type FeedbackKind,
  type FeedbackStatus,
} from "@/lib/feedback-constants";
import { FeedbackForm } from "./_form";
import { AdminRowControls } from "./_admin-row";

export const dynamic = "force-dynamic";

function statusChip(status: string) {
  const cls =
    status === "done"
      ? "chip chip-ok"
      : status === "declined"
        ? "chip chip-neutral"
        : status === "reviewing"
          ? "chip chip-accent"
          : "chip chip-warn";
  return <span className={cls}>{STATUS_LABEL[status as FeedbackStatus] ?? status}</span>;
}

function fmt(d: Date | null) {
  if (!d) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(d);
}

export default async function FeedbackPage() {
  const session = await auth();
  if (!session?.user) return null;
  const me = session.user;
  const isPlatform = me.role === "super_admin";

  const rows = isPlatform
    ? await listFeedbackForPlatform()
    : await listFeedbackForTenant(me.tenantId);

  return (
    <div className="px-4 py-5 md:px-8 md:py-6 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {isPlatform ? "문의함 (전체)" : "문의하기"}
        </h1>
        <p className="mt-1 text-sm text-[#cbd1e0]">
          {isPlatform
            ? "대리점이 보낸 건의·버그 신고입니다. 미처리 건이 위로 옵니다."
            : "ChainRemote 에 바라는 점이나 이상한 동작을 알려 주세요. 답변은 이 화면에 표시됩니다."}
        </p>
      </header>

      {!isPlatform && (
        <div className="mb-6">
          <FeedbackForm />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="panel-card p-8 text-center text-sm text-[#cbd1e0]">
          {isPlatform
            ? "아직 들어온 문의가 없습니다."
            : "아직 보낸 문의가 없습니다. 위 버튼으로 첫 문의를 남겨 보세요."}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <article key={r.id} className="panel-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip chip-neutral">
                  {KIND_LABEL[r.kind as FeedbackKind] ?? r.kind}
                </span>
                {statusChip(r.status)}
                <h2 className="font-semibold text-white">{r.title}</h2>
              </div>

              <div className="mt-1 text-xs text-[#cbd1e0]">
                {"tenantName" in r && r.tenantName ? `${r.tenantName} · ` : ""}
                {r.authorName} · {fmt(r.createdAt)}
              </div>

              <p className="mt-3 whitespace-pre-wrap text-sm text-[#eef1f7]">{r.body}</p>

              {r.reply && (
                <div className="mt-3 rounded-lg border border-[#4c7dff]/40 bg-[#4c7dff]/10 p-3">
                  <div className="text-xs font-semibold text-[#c3d3ff]">
                    베타포스랩 답변 {r.repliedAt ? `· ${fmt(r.repliedAt)}` : ""}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[#eef1f7]">{r.reply}</p>
                </div>
              )}

              {isPlatform && (
                <AdminRowControls id={r.id} status={r.status} reply={r.reply} />
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
