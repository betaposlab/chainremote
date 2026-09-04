// POST /api/sessions { remoteId }  → HQ 가 원격 접속 시작 시 호출(세션 기록 + presence).
//   remoteId(9자리/AB peer ID)로 거래처를 찾는다 — HQ 는 customerId(UUID)가 아니라 이걸 가짐.
//   ★내부기기(is_internal: 내 맥북·재성이컴 등)는 기록 안 함 → {skipped:"internal"} (고객목록 대조).
//   미등록 peer(고객목록에 없음)도 기록 안 함 → {skipped:"unknown"}.
// GET  /api/sessions/active  → 현재 활성 세션 전체 (별도 라우트).
//   (customerId 로 시작하던 옛 계약은 미사용이라 remoteId 로 교체 — 2026-07-14.)

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/schema";
import { requireApiAuth, jsonError, ApiAuthError } from "@/lib/api-auth";
import * as sessions from "@/lib/data/sessions";
import { writeAudit } from "@/lib/data/audit";

export async function POST(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const body = (await req.json().catch(() => ({}))) as {
      remoteId?: unknown;
      connDirect?: unknown;
    };
    const remoteId = typeof body.remoteId === "string" ? body.remoteId.trim() : "";
    if (!remoteId) throw new ApiAuthError(400, "remoteId 필수");
    // 직결/릴레이(마이그038) — HQ 가 연결 수립 때 이미 아는 값. 안 보내면(구버전) NULL 로 둔다.
    const connDirect =
      typeof body.connDirect === "boolean" ? body.connDirect : undefined;

    const customer = (
      await db
        .select({ id: customers.id, isInternal: customers.isInternal })
        .from(customers)
        .where(
          and(
            eq(customers.remoteId, remoteId),
            eq(customers.tenantId, me.tenantId),
          ),
        )
        .limit(1)
    )[0];

    // 미등록 peer / 내부기기는 이력에 안 남긴다(노이즈 방지). 에러 아니라 정상 skip 응답.
    //   ★다만 미등록 peer 는 **감사**에는 남긴다. 지원기록에 안 남는 접속이라 여기서
    //   빠지면 "직원이 우리 거래처가 아닌 어딘가에 붙었다"가 아무 데도 안 남는다.
    //   신규 거래처 온보딩(설치 → 접속 → 등록) 때도 나오는 정상 상황이라 양은 적다.
    //   내부기기(우리 맥북·빌드머신)는 우리 것이라 그대로 조용히 넘어간다.
    if (!customer) {
      await writeAudit({
        action: "session.unknown_peer",
        tenantId: me.tenantId,
        userId: me.uid,
        targetType: "peer",
        metadata: { remoteId },
      });
      return Response.json({ sessionId: null, skipped: "unknown" });
    }
    if (customer.isInternal)
      return Response.json({ sessionId: null, skipped: "internal" });

    const row = await sessions.startSession({
      tenantId: me.tenantId,
      operatorId: me.uid,
      customerId: customer.id,
      remoteId,
      connDirect,
    });
    return Response.json({ sessionId: row.id }, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
