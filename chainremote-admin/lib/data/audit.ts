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

import { headers } from "next/headers";
import { isIP } from "node:net";
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
  // 운영사가 대리점 owner 비번을 재설정한 것. ★우리 회사 기록으로 남긴다 —
  //   대리점 화면에 뜨면 "우리가 그 집 비번을 만졌다"가 되는데, 정작 그건 그쪽이
  //   전화로 부탁해서 한 일이다. 반대로 우리 쪽엔 남아야 나중에 "누가 바꿨냐"에 답한다.
  | "tenant.owner_password_reset"
  | "push.bulk"
  // 로그인 — "누가 언제 어느 IP 로 들어왔나". 원격지원 사업에서 사고가 나면 이게
  //   유일한 시작점이다. 실패도 남긴다(비번 대입 시도가 보이려면 실패가 있어야 한다).
  //   ★비밀번호는 어떤 형태로도 남기지 않는다. 실패에는 시도한 아이디만 적는다.
  | "auth.login"
  | "auth.login_failed"
  | "auth.takeover"
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
  /** 안 주면 요청 헤더에서 읽는다. 요청 스코프 밖(배치 등)에서 부를 때만 직접 넣는다. */
  ipAddress?: string | null;
  userAgent?: string | null;
}

// ★ip_address 는 DB 가 inet 인데 Drizzle 스키마는 text 로 선언돼 있다(001_init.sql:116).
//   문자열을 넣으면 Postgres 가 알아서 캐스팅하지만, **형식이 틀리면 insert 가 통째로
//   터진다.** writeAudit 은 실패를 삼키므로 그러면 감사 기록이 조용히 사라진다 —
//   IP 를 남기려다 기록 자체를 잃는 최악이다. 그래서 넣기 전에 net.isIP 로 거른다.
//   (정규식 대신 Node 내장을 쓰는 이유: IPv6 축약·매핑 형식까지 정확히 판정한다.)
function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw.trim();
  // "client, proxy1, proxy2" → 첫 홉. 프록시가 붙인 뒤쪽은 우리 것이라 의미 없다.
  v = v.split(",")[0].trim();
  // "[::1]:1234" / "1.2.3.4:5678" 처럼 포트가 붙어 오는 경우를 벗긴다.
  if (v.startsWith("[")) v = v.slice(1, v.indexOf("]") > 0 ? v.indexOf("]") : undefined);
  else if ((v.match(/:/g) || []).length === 1) v = v.split(":")[0];
  return isIP(v) ? v : null;
}

/** 요청 스코프에서 IP·UA 를 읽는다. 스코프 밖이면 headers() 가 던지므로 조용히 포기한다. */
async function requestMeta(): Promise<{ ip: string | null; ua: string | null }> {
  try {
    const h = await headers();
    const ip = normalizeIp(h.get("x-forwarded-for") ?? h.get("x-real-ip"));
    // UA 는 길이 제한이 없는 자유 문자열이라 잘라 둔다. 분쟁 때 필요한 건 기기 구분 정도다.
    const ua = h.get("user-agent")?.slice(0, 400) || null;
    return { ip, ua };
  } catch {
    return { ip: null, ua: null };
  }
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    // 호출부 8곳을 전부 고치는 대신 여기서 한 번 읽는다 — 새 감사 항목을 추가하는 사람이
    //   IP 를 실어 보내는 걸 기억해야 하는 구조면 반드시 빠진다(스키마에 컬럼만 있고
    //   3년치가 통째로 NULL 이던 게 그래서다).
    const meta =
      entry.ipAddress !== undefined || entry.userAgent !== undefined
        ? { ip: normalizeIp(entry.ipAddress), ua: entry.userAgent ?? null }
        : await requestMeta();
    await db.insert(auditLogs).values({
      action: entry.action,
      tenantId: entry.tenantId ?? null,
      userId: entry.userId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
      ipAddress: meta.ip,
      userAgent: meta.ua,
    });
  } catch (e) {
    console.error("[audit] 기록 실패", entry.action, e);
  }
}
