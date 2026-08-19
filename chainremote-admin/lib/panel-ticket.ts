// 본사 앱 → 관리 패널 한 번 열기 티켓 (마이그050).
//
// 본사 앱은 이미 Bearer 로 인증된 신원을 갖고 있다. 그 신원을 브라우저 세션으로 넘기는
// 유일한 실용적 통로가 주소이므로(브라우저를 여는 것 말고는 할 수 있는 게 없다), 주소에
// 실어도 되는 값을 만든다 — 짧게 살고, 한 번 쓰면 사라지고, 그 자체로는 아무 정보도
// 담지 않는 난수.
//
// ★한 번만 쓰이게 하는 것이 이 파일의 핵심이다. 서명 토큰(JWT)이면 코드는 더 짧지만
// 만료 전까지 재사용이 가능하고, 주소는 방문기록에 남는다. 저장소를 두는 대가로 '소비되면
// 끝' 을 보장한다.

import { createHash, randomBytes } from "crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { panelTickets } from "@/lib/schema";

/** 살아 있는 시간. 앱이 브라우저를 여는 데 걸리는 시간만 덮으면 된다. */
const TTL_SEC = 60;

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 티켓 발급 — 평문은 이 반환값이 유일하다(저장은 해시). */
export async function issuePanelTicket(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(panelTickets).values({
    tokenHash: hash(token),
    userId,
    expiresAt: new Date(Date.now() + TTL_SEC * 1000),
  });
  // 만료분 청소 — 안 쓰인 티켓이 쌓이지 않게 발급할 때 곁다리로 치운다.
  //   실패해도 발급은 성공해야 하므로 삼킨다.
  try {
    await db.delete(panelTickets).where(lt(panelTickets.expiresAt, new Date()));
  } catch {
    // 청소 실패는 기능과 무관하다.
  }
  return token;
}

/**
 * 티켓 소비 — 유효하면 userId, 아니면 null. **성공이든 실패든 그 행은 사라진다.**
 *
 * ★검사와 삭제를 한 문장으로 한다(DELETE ... RETURNING). 읽고 나서 지우면 그 사이에
 * 같은 티켓이 두 번 통과할 수 있다 — 주소가 실수로 공유되면 실제로 일어난다.
 */
export async function consumePanelTicket(token: string): Promise<string | null> {
  if (!token || token.length < 16) return null;
  const rows = await db
    .delete(panelTickets)
    .where(eq(panelTickets.tokenHash, hash(token)))
    .returning({ userId: panelTickets.userId, expiresAt: panelTickets.expiresAt });
  const row = rows[0];
  if (!row) return null;
  // 만료된 티켓도 위에서 이미 지워졌다 — 그걸로 충분하고, 여기선 거절만 한다.
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row.userId;
}
