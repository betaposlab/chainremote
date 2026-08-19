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

/** 살아 있는 시간.
 *
 *  ★60초에서 늘렸다(2026-08-20). 브라우저에 다른 계정이 로그인돼 있으면 곧바로 갈아타지
 *  않고 사람에게 물어보는데, **읽는 동안 만료되는 확인창은 고장이다.** 티켓의 실제 방어는
 *  수명이 아니라 '한 번 쓰면 사라진다'와 해시 저장이고, 전달 경로도 이 PC 의 기본
 *  브라우저 하나뿐이다. 3분은 사람이 한 번 판단할 시간이다. */
const TTL_SEC = 180;

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

/**
 * 티켓 엿보기 — **소비하지 않고** 누구 것인지만 본다.
 *
 * 계정 전환을 물어보려면 "누구로 바꾸는지"를 먼저 화면에 적어야 하는데, 그러자고 티켓을
 * 소비해 버리면 사용자가 [전환] 을 누를 때 쓸 것이 없다. 그래서 읽기만 하는 갈래를 둔다.
 *
 * ★새로 열리는 구멍은 없다. 티켓을 가진 쪽은 어차피 소비할 수 있고, 이 함수는 아무것도
 * 바꾸지 않는다. 실제 로그인은 여전히 consumePanelTicket 한 곳에서만 일어난다.
 */
export async function peekPanelTicket(token: string): Promise<string | null> {
  if (!token || token.length < 16) return null;
  const rows = await db
    .select({ userId: panelTickets.userId, expiresAt: panelTickets.expiresAt })
    .from(panelTickets)
    .where(eq(panelTickets.tokenHash, hash(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row.userId;
}
