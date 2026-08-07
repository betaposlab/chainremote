"use server";

// 대리점 문의함 액션 — 제출은 로그인한 누구나, 상태·답변은 플랫폼 운영자만.
//
// 제출을 viewer 까지 열어 둔 건 의도다. 버그를 가장 먼저 만나는 사람이 권한이 낮은
//   직원인 경우가 흔한데, 거기서 막으면 그 신고는 영영 안 올라온다.

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { writeAudit } from "@/lib/data/audit";
import * as data from "@/lib/data/feedback";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("로그인 필요");
  return session.user;
}

async function requireSuperAdmin() {
  const me = await requireSession();
  if (me.role !== "super_admin") throw new Error("권한이 없습니다");
  return me;
}

export async function submitFeedbackAction(form: FormData): Promise<void> {
  const me = await requireSession();
  await data.createFeedback({
    tenantId: me.tenantId,
    userId: me.id,
    authorName: me.displayName || me.email || "",
    kind: String(form.get("kind") ?? "suggestion"),
    title: String(form.get("title") ?? ""),
    body: String(form.get("body") ?? ""),
  });
  revalidatePath("/feedback");
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
  revalidatePath("/feedback");
}
