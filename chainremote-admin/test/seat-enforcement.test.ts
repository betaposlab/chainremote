import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { testDb } from "./helpers/db";
import {
  claimSeat,
  takeoverSeat,
  touchHeartbeat,
  releaseSeat,
  getActiveSession,
} from "@/lib/data/active-sessions";
import { tenants, users, activeLoginSessions } from "@/lib/schema";

// ★ 좌석 과금(단일 동시세션 enforcement) 데이터 레이어 계약 검증.
// 스펙: docs/chainremote/SEAT_ENFORCEMENT.md, 마이그 010.
// active_login_sessions 는 user_id PK 라 계정당 active 1건. 이 파일은 코이노식
// takeover 모델의 적대적 케이스를 SQL 레벨(pglite)로 실검증한다 — 목킹 없음.
//
// 함수 계약(lib/data/active-sessions.ts):
//   claimSeat(p): ClaimResult{ claimed, occupiedBy? }  — 조건부 UPSERT(같은기기 or orphan 이면 확보)
//   takeoverSeat(p): void                              — 무조건 덮어쓰기(강제 종료)
//   touchHeartbeat(userId, jti): boolean               — jti 일치 시 true, 인계당했으면 false
//   releaseSeat(userId, jti): void                     — 내 jti 일 때만 삭제

async function makeUser(slug: string, email: string): Promise<string> {
  const db = testDb();
  const [t] = await db
    .insert(tenants)
    .values({ slug, displayName: slug })
    .returning({ id: tenants.id });
  const [u] = await db
    .insert(users)
    .values({ tenantId: t.id, email, passwordHash: "x", displayName: email })
    .returning({ id: users.id });
  return u.id;
}

function seat(userId: string, deviceId: string, label = deviceId) {
  return { userId, jti: randomUUID(), deviceId, deviceLabel: label, ip: null };
}

async function seatRowCount(userId: string): Promise<number> {
  const rows = await testDb()
    .select()
    .from(activeLoginSessions)
    .where(eq(activeLoginSessions.userId, userId));
  return rows.length;
}

describe("좌석 enforcement — 단일 동시세션(코이노식 takeover)", () => {
  // (a) 다른 기기 동시 점유 시도 = 거부(occupied)
  it("기기A 점유 후 기기B(다른 device_id) claimSeat 은 occupied 로 거부된다", async () => {
    const uid = await makeUser("betapos", "chang");

    const a = await claimSeat(seat(uid, "DEVICE-A", "재성이-PC"));
    expect(a.claimed).toBe(true);

    const b = await claimSeat(seat(uid, "DEVICE-B", "집-윈컴"));
    expect(b.claimed).toBe(false);
    // 점유자 표시정보가 현재 살아있는 기기A 를 가리킨다
    expect(b.occupiedBy?.deviceLabel).toBe("재성이-PC");
    expect(b.occupiedBy?.since).toBeInstanceOf(Date);

    // 좌석은 여전히 A 것 — B 가 슬쩍 못 들어왔다
    const row = await getActiveSession(uid);
    expect(row?.deviceId).toBe("DEVICE-A");
    expect(await seatRowCount(uid)).toBe(1);
  });

  // (b) 같은 기기 재claim = 프롬프트 없이 자동 회수
  it("같은 device_id 로 재claim 하면 프롬프트 없이 통과(자동 회수)한다", async () => {
    const uid = await makeUser("betapos", "chang");

    const first = seat(uid, "DEVICE-A");
    expect((await claimSeat(first)).claimed).toBe(true);

    // 같은 기기가 새 jti 로 다시 로그인(앱 재시작 등) → 자기 좌석 회수
    const again = seat(uid, "DEVICE-A");
    const r = await claimSeat(again);
    expect(r.claimed).toBe(true);

    // 여전히 1행이고, jti 가 마지막 것으로 회전됐다
    expect(await seatRowCount(uid)).toBe(1);
    const row = await getActiveSession(uid);
    expect(row?.jti).toBe(again.jti);
    // 옛 jti 는 이제 무효
    expect(await touchHeartbeat(uid, first.jti)).toBe(false);
  });

  // (c) orphan TTL(2분) 초과한 죽은 세션은 새 기기가 프롬프트 없이 통과
  it("2분 넘게 heartbeat 끊긴 orphan 세션은 새 기기가 프롬프트 없이 인수한다", async () => {
    const db = testDb();
    const uid = await makeUser("betapos", "chang");

    const dead = seat(uid, "DEVICE-A", "죽은-노트북");
    expect((await claimSeat(dead)).claimed).toBe(true);

    // heartbeat 를 3분 전으로 후퇴 → orphan(스펙 §7: TTL 2분)
    await db
      .update(activeLoginSessions)
      .set({ lastSeenAt: new Date(Date.now() - 3 * 60 * 1000) })
      .where(eq(activeLoginSessions.userId, uid));

    const fresh = seat(uid, "DEVICE-B", "새-PC");
    const r = await claimSeat(fresh);
    expect(r.claimed).toBe(true); // orphan 이라 모달 없이 통과

    const row = await getActiveSession(uid);
    expect(row?.deviceId).toBe("DEVICE-B");
    // 옛(죽은) 기기 jti 는 무효화됨
    expect(await touchHeartbeat(uid, dead.jti)).toBe(false);
    expect(await seatRowCount(uid)).toBe(1);
  });

  // orphan 경계: 아직 2분 안 지난 세션은 여전히 살아있어 거부돼야 한다
  it("heartbeat 이 1분 전이면(TTL 미만) 아직 살아있어 새 기기는 거부된다", async () => {
    const db = testDb();
    const uid = await makeUser("betapos", "chang");

    expect((await claimSeat(seat(uid, "DEVICE-A"))).claimed).toBe(true);
    await db
      .update(activeLoginSessions)
      .set({ lastSeenAt: new Date(Date.now() - 60 * 1000) }) // 1분 전 = 아직 생존
      .where(eq(activeLoginSessions.userId, uid));

    const r = await claimSeat(seat(uid, "DEVICE-B"));
    expect(r.claimed).toBe(false);
  });

  // (d) takeover → 옛 jti 무효화. 옛 기기 heartbeat 는 REVOKED(false)
  it("takeover 후 옛 jti 의 heartbeat 는 revoked(false), 새 jti 는 살아있다(true)", async () => {
    const uid = await makeUser("betapos", "chang");

    const old = seat(uid, "DEVICE-A", "옛-기기");
    expect((await claimSeat(old)).claimed).toBe(true);
    // takeover 전, 옛 jti 는 정상 heartbeat
    expect(await touchHeartbeat(uid, old.jti)).toBe(true);

    // "강제 종료하고 사용" — 무조건 덮어쓰기
    const neo = seat(uid, "DEVICE-B", "새-기기");
    await takeoverSeat(neo);

    // 옛 기기 다음 heartbeat = 인계당함 → false (라우트가 401 REVOKED)
    expect(await touchHeartbeat(uid, old.jti)).toBe(false);
    // 새 기기 heartbeat = 유효
    expect(await touchHeartbeat(uid, neo.jti)).toBe(true);

    const row = await getActiveSession(uid);
    expect(row?.jti).toBe(neo.jti);
    expect(row?.deviceId).toBe("DEVICE-B");
    expect(await seatRowCount(uid)).toBe(1);
  });

  // (e) 동시 2기기 takeover 경쟁 시 마지막 1건만 승 (user_id PK)
  it("두 기기가 연달아 takeover 하면 마지막 1건만 좌석을 갖는다(user_id PK, 1행)", async () => {
    const uid = await makeUser("betapos", "chang");
    expect((await claimSeat(seat(uid, "DEVICE-A"))).claimed).toBe(true);

    const b = seat(uid, "DEVICE-B");
    const c = seat(uid, "DEVICE-C");
    await takeoverSeat(b);
    await takeoverSeat(c); // 마지막

    expect(await seatRowCount(uid)).toBe(1); // PK 라 절대 2행 없음
    const row = await getActiveSession(uid);
    expect(row?.jti).toBe(c.jti);
    expect(row?.deviceId).toBe("DEVICE-C");
    // 중간 승자(B)도 무효
    expect(await touchHeartbeat(uid, b.jti)).toBe(false);
    expect(await touchHeartbeat(uid, c.jti)).toBe(true);
  });

  // releaseSeat 안전성 — 인계당한 뒤 옛 기기의 로그아웃이 새 좌석을 지우면 안 됨
  it("인계당한 옛 jti 로 releaseSeat 하면 새 기기 좌석은 보존된다", async () => {
    const uid = await makeUser("betapos", "chang");
    const old = seat(uid, "DEVICE-A");
    expect((await claimSeat(old)).claimed).toBe(true);

    const neo = seat(uid, "DEVICE-B");
    await takeoverSeat(neo);

    // 옛 기기가 뒤늦게 로그아웃(내 jti 로) → 새 좌석 건드리면 안 됨
    await releaseSeat(uid, old.jti);
    expect(await seatRowCount(uid)).toBe(1);
    expect((await getActiveSession(uid))?.jti).toBe(neo.jti);

    // 진짜 주인이 로그아웃하면 좌석 비워짐
    await releaseSeat(uid, neo.jti);
    expect(await seatRowCount(uid)).toBe(0);
  });

  it("계정 격리 — 유저A 의 좌석은 유저B 의 claim/heartbeat 에 영향 없다", async () => {
    const ua = await makeUser("tenant-a", "userA");
    const ub = await makeUser("tenant-b", "userB");

    const sa = seat(ua, "A-DEV");
    const sb = seat(ub, "B-DEV");
    expect((await claimSeat(sa)).claimed).toBe(true);
    expect((await claimSeat(sb)).claimed).toBe(true); // 서로 다른 user_id → 둘 다 성공

    // A 의 jti 로 B 좌석 heartbeat 못 함(교차 무효)
    expect(await touchHeartbeat(ub, sa.jti)).toBe(false);
    expect(await touchHeartbeat(ua, sa.jti)).toBe(true);
    expect(await touchHeartbeat(ub, sb.jti)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // ★ 취약점 문서화 (현재 동작 = PASS, 원하는 안전동작 = it.todo)
  //
  // orphan(2분 무heartbeat) 인수 경로는 "살아있는 세션 인수(takeover)" 와 달리
  // 사용자 확인/모달이 전혀 없다. 살아있는 세션은 claimSeat 이 occupied 를 돌려
  // 라우트가 "강제 종료하시겠습니까?" 를 띄우지만, orphan 은 claimSeat 이 곧장
  // claimed=true 를 준다. 즉 HQ 계정의 노트북이 2분 넘게 절전/회의로 idle 이면,
  // 자격증명을 쥔 제3자가 마찰 0 으로 좌석을 조용히 빼앗고 옛 기기를 kick 한다.
  // 게다가 이 조용한 인수는 어떤 감사 로그/알림도 남기지 않는다(테이블 덮어쓰기뿐).
  // → 아래 테스트는 "현재 동작(무프롬프트·무감사)" 을 못박아 회귀 감시한다.
  it("orphan 인수는 현재 아무런 감사 흔적을 남기지 않는다 (취약점 문서화)", async () => {
    const db = testDb();
    const uid = await makeUser("betapos", "chang");
    expect((await claimSeat(seat(uid, "VICTIM-LAPTOP"))).claimed).toBe(true);
    await db
      .update(activeLoginSessions)
      .set({ lastSeenAt: new Date(Date.now() - 3 * 60 * 1000) })
      .where(eq(activeLoginSessions.userId, uid));

    // 공격자 기기가 조용히 인수 — 라우트에 넘길 어떤 "인수됨" 신호도 없다.
    const r = await claimSeat(seat(uid, "ATTACKER-PC"));
    expect(r.claimed).toBe(true);
    // ClaimResult 에는 "orphan 을 인수했다"는 표식이 없어 라우트가 알림/로그를 남길 수 없다.
    expect(r.occupiedBy).toBeUndefined();
    // 테이블은 단일 행으로 그냥 덮여, 피해 기기 정보는 흔적 없이 사라진다.
    expect(await seatRowCount(uid)).toBe(1);
    expect((await getActiveSession(uid))?.deviceId).toBe("ATTACKER-PC");
  });

  // 원하는 안전동작(미구현): orphan 을 조용히 인수하더라도 인수 사실을
  // ClaimResult 로 알려 라우트가 감사 로그/이메일 알림을 남길 수 있어야 한다.
  it.todo(
    "orphan 인수 시 ClaimResult 가 '인수됨(previous device)' 을 알려 감사/알림을 가능케 해야 한다",
  );
});
