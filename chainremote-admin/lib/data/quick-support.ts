// 임시 원격 세션 — 626.kr 초록 버튼으로 받은 RustDesk 가 스스로 알려 오는 ID 를 받아 둔다.
// 설계 배경은 lib/quick-support.ts 와 migrations/054.

import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { quickSupportSessions, tenants } from "@/lib/schema";
import {
  QUICK_CODE_RE,
  QUICK_SUPPORT_TOKEN_RE,
  quickSupportFilenameWithToken,
} from "@/lib/quick-support";

/** RustDesk 는 15초마다 신호를 보낸다. 세 번 놓치면 꺼진 것으로 본다. */
export const QUICK_SUPPORT_ALIVE_MS = 50_000;
/** 받은 파일이 신고할 수 있는 기간. 지나면 조용히 무시한다(파일은 그래도 켜지고 원격은 된다). */
const TOKEN_TTL_MS = 24 * 3600_000;
/** 이보다 오래된 행은 다음 클릭 때 지운다 — 쌓아 둘 기록이 아니다. */
const PURGE_AFTER_MS = 7 * 24 * 3600_000;

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function newToken(): string {
  const bytes = randomBytes(12);
  let out = "";
  // 256 % 36 != 0 이라 약간 치우치지만, 이 토큰은 비밀번호가 아니라 24시간짜리 꼬리표다.
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return out;
}

/** 대리점 번호 → 대리점. 정지된 대리점은 없는 번호처럼 답한다. */
export async function findTenantByQuickCode(
  code: string,
): Promise<{ id: string; name: string } | null> {
  if (!QUICK_CODE_RE.test(code)) return null;
  const [t] = await db
    .select({
      id: tenants.id,
      displayName: tenants.displayName,
      supportDisplayName: tenants.supportDisplayName,
    })
    .from(tenants)
    .where(and(eq(tenants.quickCode, code), eq(tenants.isActive, true)))
    .limit(1);
  if (!t) return null;
  // 거래처에 내세우는 상호가 따로 있으면 그걸 보여 준다(수락창과 같은 규칙).
  return { id: t.id, name: t.supportDisplayName?.trim() || t.displayName };
}

export async function getQuickCode(tenantId: string): Promise<string | null> {
  const [t] = await db
    .select({ quickCode: tenants.quickCode })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return t?.quickCode ?? null;
}

/** 초록 버튼 한 번 — 세션을 만들고, 그 토큰이 실린 파일 이름을 돌려준다. */
export async function createQuickSupportSession(input: {
  tenantId: string;
  arch: string;
  ip: string | null;
}): Promise<{ token: string; filename: string }> {
  // 묵은 행 청소. 실패해도 발급은 계속한다.
  await db
    .delete(quickSupportSessions)
    .where(lt(quickSupportSessions.createdAt, new Date(Date.now() - PURGE_AFTER_MS)))
    .catch(() => undefined);

  for (let i = 0; i < 40; i++) {
    const token = newToken();
    const filename = quickSupportFilenameWithToken(token);
    if (!filename) continue; // 파일 이름으로 못 쓰는 모양 — 다시 뽑는다.
    const [row] = await db
      .insert(quickSupportSessions)
      .values({ tenantId: input.tenantId, token, arch: input.arch, clickIp: input.ip })
      .onConflictDoNothing({ target: quickSupportSessions.token })
      .returning({ id: quickSupportSessions.id });
    if (row) return { token, filename };
  }
  throw new Error("quick-support: 토큰 발급 실패");
}

/** 고객 PC 의 원격 ID 로 올 수 있는 모양. 상류 숫자 ID 와 우리 AB 형식 둘 다 받는다. */
const REMOTE_ID_RE = /^[A-Za-z0-9_-]{6,16}$/;

function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // 제어문자 제거 — HQ 화면에 그대로 찍히는 값이다.
  const t = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return t ? t.slice(0, max) : null;
}

/**
 * 고객 PC 의 RustDesk 가 보낸 신고를 받아 적는다. 모르는/만료된 토큰이면 false.
 *
 * ID 가 바뀌어 오면 새 값으로 덮는다 — 같은 파일을 다른 PC 에서 켠 것이고, 지금 켜져 있는
 * 쪽이 붙을 대상이다. 누가 엉뚱한 ID 를 보내도 그 PC 가 [수락] 을 눌러야 연결되고,
 * 남의 대리점 에이전트는 운영자 대리점이 달라 거절한다.
 */
export async function recordQuickSupportReport(
  token: string,
  report: { remoteId: unknown; hostname?: unknown; os?: unknown; connected?: boolean },
): Promise<boolean> {
  if (!QUICK_SUPPORT_TOKEN_RE.test(token)) return false;
  const remoteId = typeof report.remoteId === "string" ? report.remoteId.trim() : "";
  if (!REMOTE_ID_RE.test(remoteId)) return false;
  const now = new Date();
  const hostname = clean(report.hostname, 64);
  const os = clean(report.os, 120);
  const [row] = await db
    .update(quickSupportSessions)
    .set({
      remoteId,
      lastSeenAt: now,
      firstSeenAt: sql`COALESCE(${quickSupportSessions.firstSeenAt}, ${now})`,
      ...(hostname ? { hostname } : {}),
      ...(os ? { os } : {}),
      ...(report.connected === undefined ? {} : { connected: report.connected }),
    })
    .where(
      and(
        eq(quickSupportSessions.token, token),
        gt(quickSupportSessions.createdAt, new Date(now.getTime() - TOKEN_TTL_MS)),
      ),
    )
    .returning({ id: quickSupportSessions.id });
  return !!row;
}

export type QuickSupportWaiting = {
  id: string;
  remoteId: string;
  hostname: string | null;
  os: string | null;
  firstSeenAt: string | null;
};

/** 지금 켜져 있고 아직 아무도 안 붙은 임시 원격 — 그 대리점 것만. */
export async function listQuickSupportWaiting(tenantId: string): Promise<QuickSupportWaiting[]> {
  const rows = await db
    .select({
      id: quickSupportSessions.id,
      remoteId: quickSupportSessions.remoteId,
      hostname: quickSupportSessions.hostname,
      os: quickSupportSessions.os,
      firstSeenAt: quickSupportSessions.firstSeenAt,
    })
    .from(quickSupportSessions)
    .where(
      and(
        eq(quickSupportSessions.tenantId, tenantId),
        isNotNull(quickSupportSessions.remoteId),
        eq(quickSupportSessions.connected, false),
        gt(quickSupportSessions.lastSeenAt, new Date(Date.now() - QUICK_SUPPORT_ALIVE_MS)),
      ),
    )
    .orderBy(desc(quickSupportSessions.firstSeenAt))
    .limit(20);
  // 같은 PC 가 파일을 두 번 받아 두 번 켠 경우 한 줄로.
  const seen = new Set<string>();
  const out: QuickSupportWaiting[] = [];
  for (const r of rows) {
    if (!r.remoteId || seen.has(r.remoteId)) continue;
    seen.add(r.remoteId);
    out.push({
      id: r.id,
      remoteId: r.remoteId,
      hostname: r.hostname,
      os: r.os,
      firstSeenAt: r.firstSeenAt ? new Date(r.firstSeenAt).toISOString() : null,
    });
  }
  return out;
}
