// 감사 로그 — "누가 무엇을 지웠나/바꿨나".
//
// audit_logs 테이블은 처음부터 있었지만 여태 아무도 쓰지 않아 0건이었다(2026-08-07 확인).
// 대리점 하나에 직원이 여럿 붙는 판매 모델에서는, 거래처가 사라졌을 때 되돌릴 방법이
// 없더라도 최소한 누가 언제 지웠는지는 남아야 한다.
//
// ★남기는 것은 되돌릴 수 없거나 권한이 걸린 행위뿐이다. 조회·일상 수정까지 남기면
//   노이즈에 묻혀 정작 필요한 한 줄을 못 찾는다. 목록은 AuditAction 이 곧 정의다.
//
// ★기록 실패가 본 작업을 막지 않는다. 감사 기록이 안 됐다고 거래처 삭제를 되돌리면
//   사용자에겐 "삭제가 실패했다"로 보이는데 실제로는 지워졌을 수도 있어 더 나쁘다.
//   대신 서버 로그에 남겨 조용히 사라지지는 않게 한다.

import { db } from "@/lib/db";
import { auditLogs } from "@/lib/schema";

/** 남기는 행위. 여기 없는 것은 남기지 않는다 — 목록이 곧 정책이다. */
export type AuditAction =
  | "customer.delete"
  | "tenant.delete"
  | "user.create"
  | "user.delete"
  | "user.role_change"
  | "user.password_reset"
  | "push.bulk"
  | "tenant.unattended_change"
  // 대리점에 답이 나가는 행위 — 누가 무엇을 보류로 돌렸는지가 나중에 문제가 된다.
  | "feedback.update"
  // 지워진 문의는 복구할 수 없다. 제목만이라도 남겨야 "그런 요청 받은 적 없다"를 막는다.
  | "feedback.delete";

export interface AuditEntry {
  action: AuditAction;
  tenantId?: string | null;
  userId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** 사람이 나중에 읽을 최소한의 맥락(지워진 거래처 상호 등). 비밀값은 넣지 않는다. */
  metadata?: Record<string, unknown> | null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      action: entry.action,
      tenantId: entry.tenantId ?? null,
      userId: entry.userId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
    });
  } catch (e) {
    console.error("[audit] 기록 실패", entry.action, e);
  }
}
