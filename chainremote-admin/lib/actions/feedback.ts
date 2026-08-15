"use server";

// 대리점 문의함 액션 — 제출은 로그인한 누구나, 상태·답변은 플랫폼 운영자만.
//
// 제출을 viewer 까지 열어 둔 건 의도다. 버그를 가장 먼저 만나는 사람이 권한이 낮은
//   직원인 경우가 흔한데, 거기서 막으면 그 신고는 영영 안 올라온다.

import { revalidatePath } from "next/cache";
import { requireLiveUserOrThrow } from "@/lib/auth-guard";
import { writeAudit } from "@/lib/data/audit";
import * as data from "@/lib/data/feedback";
import {
  MAX_IMAGES_PER_FEEDBACK,
  removeStoredImage,
  storeImage,
  type StoredImage,
} from "@/lib/feedback-upload";

async function requireSession() {
  // 쿠키의 존재가 아니라 **계정이 지금도 살아 있는지**를 본다(퇴사자 즉시 차단).
  return requireLiveUserOrThrow();
}

async function requireSuperAdmin() {
  const me = await requireSession();
  if (me.role !== "super_admin") throw new Error("권한이 없습니다");
  return me;
}

export async function submitFeedbackAction(form: FormData): Promise<void> {
  const me = await requireSession();

  const files = form
    .getAll("images")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_IMAGES_PER_FEEDBACK) {
    throw new Error(`이미지는 최대 ${MAX_IMAGES_PER_FEEDBACK}장까지 첨부할 수 있습니다.`);
  }

  // 파일을 먼저 디스크에 쓰고 그 결과를 문의 행과 한 트랜잭션으로 넣는다.
  //   중간에 실패하면 이미 쓴 파일을 되감는다 — 안 그러면 아무 문의에도 안 걸린
  //   고아 파일이 남는다.
  const stored: StoredImage[] = [];
  try {
    for (const f of files) stored.push(await storeImage(f));
    await data.createFeedback({
      tenantId: me.tenantId,
      userId: me.id,
      authorName: me.displayName || me.email || "",
      kind: String(form.get("kind") ?? "suggestion"),
      title: String(form.get("title") ?? ""),
      body: String(form.get("body") ?? ""),
      images: stored,
    });
  } catch (e) {
    await Promise.all(stored.map((s) => removeStoredImage(s.storedName)));
    throw e;
  }
  // 배지가 루트 layout 에 있어 페이지만 재검증하면 숫자가 안 줄어든다 —
  //   처리했는데 그대로 남은 것처럼 보인다. layout 을 재검증하면 하위 페이지도 같이 갱신된다.
  revalidatePath("/", "layout");
}

export async function deleteFeedbackAction(form: FormData): Promise<void> {
  const me = await requireSession();
  const id = Number(form.get("id"));
  if (!Number.isFinite(id)) throw new Error("잘못된 요청입니다");

  const row = await data.deleteFeedback(
    id,
    me.role === "super_admin" ? { platform: true } : { tenantId: me.tenantId },
  );
  // 데이터 레이어의 WHERE 가 권한·상태를 함께 막으므로, 못 지웠다는 건 조건에 걸렸다는 뜻이다.
  if (!row) {
    throw new Error("이미 답변이 달렸거나 검토 중인 문의는 지울 수 없습니다.");
  }

  await writeAudit({
    tenantId: row.tenantId,
    userId: me.id,
    action: "feedback.delete",
    targetType: "feedback",
    metadata: { id, title: row.title, byPlatform: me.role === "super_admin" },
  });
  // 배지가 루트 layout 에 있어 페이지만 재검증하면 숫자가 안 줄어든다 —
  //   처리했는데 그대로 남은 것처럼 보인다. layout 을 재검증하면 하위 페이지도 같이 갱신된다.
  revalidatePath("/", "layout");
}

export async function updateFeedbackAction(form: FormData): Promise<void> {
  const me = await requireSuperAdmin();
  const id = Number(form.get("id"));
  if (!Number.isFinite(id)) throw new Error("잘못된 요청입니다");

  const status = form.get("status");
  const reply = form.get("reply");
  const row = await data.updateFeedbackStatus(id, {
    ...(status !== null ? { status: String(status) } : {}),
    ...(reply !== null ? { reply: String(reply) } : {}),
  });
  if (!row) throw new Error("문의를 찾을 수 없습니다");

  // 대리점에 답이 나가는 행위라 감사 기록을 남긴다 — 누가 무엇을 보류로 돌렸는지가
  //   나중에 반드시 문제가 된다.
  await writeAudit({
    tenantId: row.tenantId,
    userId: me.id,
    action: "feedback.update",
    targetType: "feedback",
    metadata: {
      id,
      ...(status !== null ? { status: String(status) } : {}),
      ...(reply !== null ? { replied: String(reply).trim().length > 0 } : {}),
    },
  });
  // 배지가 루트 layout 에 있어 페이지만 재검증하면 숫자가 안 줄어든다 —
  //   처리했는데 그대로 남은 것처럼 보인다. layout 을 재검증하면 하위 페이지도 같이 갱신된다.
  revalidatePath("/", "layout");
}
