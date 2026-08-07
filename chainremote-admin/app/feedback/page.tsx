// 문의함 — 대리점은 자기가 낸 것만, 플랫폼 운영자는 전 대리점을 본다.
//
// 게시판이 아닌 이유는 마이그 031 주석에 적어 뒀다. 요지는 대리점끼리 서로의 글을 볼
//   이유가 없고, 상호·업무 사정이 그대로 드러난다는 것이다.
//
// 목록은 접힌 한 줄이 기본이다(_row.tsx). 카드로 다 펼쳐 두면 몇 건만 쌓여도 훑을 수 없다.

import { auth } from "@/auth";
import {
  listFeedbackForPlatform,
  listFeedbackForTenant,
  listImagesFor,
  markRepliesSeen,
} from "@/lib/data/feedback";
import { FeedbackForm } from "./_form";
import { FeedbackRow, type FeedbackRowData } from "./_row";

export const dynamic = "force-dynamic";

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

  // 첨부는 한 번에 모아 온다(N+1 회피). 보관 기간이 지나 정리된 건은 여기 안 잡히고,
  //   그 사실은 hadImages 로 구분해 "삭제됨"을 표시한다.
  const images = await listImagesFor(rows.map((r) => r.id));
  const imagesByFeedback = new Map<number, { id: number; originalName: string }[]>();
  for (const im of images) {
    const list = imagesByFeedback.get(im.feedbackId) ?? [];
    list.push({ id: im.id, originalName: im.originalName });
    imagesByFeedback.set(im.feedbackId, list);
  }

  // 대리점이 이 화면을 열면 새 답변 배지를 내린다. ★조회 뒤에 호출해야 이번 렌더에는
  //   "새 답변" 상태가 그대로 보이고, 다음 이동부터 배지가 사라진다.
  if (!isPlatform) {
    await markRepliesSeen(me.tenantId);
  }

  // Date 는 클라이언트 컴포넌트로 그대로 넘기지 않고 여기서 문자열로 굳힌다 —
  //   서버·브라우저 시간대가 달라 같은 값이 다르게 찍히는 것을 막는다(Asia/Seoul 고정).
  const data: FeedbackRowData[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    status: r.status,
    reply: r.reply,
    repliedAt: r.repliedAt ? fmt(r.repliedAt) : null,
    authorName: r.authorName,
    hadImages: r.hadImages,
    createdAt: fmt(r.createdAt),
    // 운영자 목록에만 있는 필드다. 두 조회의 반환 타입이 달라 in 검사만으로는
    //   unknown 으로 남으므로 여기서 좁혀 준다.
    tenantName: "tenantName" in r ? ((r.tenantName as string | null) ?? null) : null,
    images: imagesByFeedback.get(r.id) ?? [],
  }));

  return (
    <div className="px-4 py-5 md:px-8 md:py-6 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {isPlatform ? "문의함 (전체)" : "문의하기"}
        </h1>
        <p className="mt-1 text-sm text-[#cbd1e0]">
          {isPlatform
            ? "대리점이 보낸 건의·버그 신고입니다. 미처리 건이 위로 옵니다. 줄을 누르면 펼쳐집니다."
            : "ChainRemote 에 바라는 점이나 이상한 동작을 알려 주세요. 답변은 이 화면에 표시됩니다."}
        </p>
      </header>

      {!isPlatform && (
        <div className="mb-6">
          <FeedbackForm />
        </div>
      )}

      {data.length === 0 ? (
        <div className="panel-card p-8 text-center text-sm text-[#cbd1e0]">
          {isPlatform
            ? "아직 들어온 문의가 없습니다."
            : "아직 보낸 문의가 없습니다. 위 버튼으로 첫 문의를 남겨 보세요."}
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((r) => (
            <FeedbackRow
              key={r.id}
              row={r}
              isPlatform={isPlatform}
              canDelete={r.status === "open" && !r.reply}
            />
          ))}
        </div>
      )}
    </div>
  );
}
