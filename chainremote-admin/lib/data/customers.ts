// 거래처 데이터 레이어 — Server Actions(패널 UI) 와 REST API(데스크톱 앱) 가 공유.
// 프레임워크 의존 없음(revalidatePath/redirect 없음) — 후처리는 호출 측 몫.
// 모든 함수는 tenantId 격리 강제. 호출자는 자기 세션의 tenantId 만 넘긴다.

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, tenants, userFavorites } from "@/lib/schema";
import { linkFavoritesToCustomer } from "@/lib/data/favorites";
import { generateHeartbeatToken, hashHeartbeatToken } from "@/lib/heartbeat-token";

export interface CustomerFields {
  name: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  remoteId: string | null;
  accessPassword: string | null;
  notes: string | null;
  // 담당 직원(수동 배정). null = 미배정. create 시 null/미지정이면 생성자(ctx)로 폴백.
  // 옵셔널인 이유: HQ-facing API(app/api/customers)는 배정 개념 없이 필드를 만드는데,
  //   undefined 는 update 의 drizzle .set 에서 무시돼 기존 배정이 보존된다.
  assignedUserId?: string | null;
}

export async function listCustomers(tenantId: string) {
  return db
    .select()
    .from(customers)
    .where(eq(customers.tenantId, tenantId))
    .orderBy(desc(customers.updatedAt));
}

export async function getCustomer(id: string, tenantId: string) {
  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createCustomer(
  fields: CustomerFields,
  ctx: { tenantId: string; assignedUserId: string },
) {
  const [row] = await db
    .insert(customers)
    .values({
      tenantId: ctx.tenantId,
      ...fields,
      // null 이면 생성자로 폴백 (spread 뒤라 명시값이 우선).
      assignedUserId: fields.assignedUserId ?? ctx.assignedUserId,
    })
    .returning();
  // remote_id 로 등록했다면 그 ID 의 orphan 즐겨찾기를 새 거래처에 붙인다.
  if (row.remoteId) {
    await linkFavoritesToCustomer(row.remoteId, row.id, ctx.tenantId);
  }
  return row;
}

export async function updateCustomer(
  id: string,
  fields: CustomerFields,
  ctx: { tenantId: string },
) {
  const [row] = await db
    .update(customers)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
    .returning();
  return row ?? null;
}

export async function deleteCustomer(id: string, ctx: { tenantId: string }) {
  const result = await db
    .delete(customers)
    .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
    .returning({ id: customers.id });
  return result.length > 0;
}

/**
 * "신규 거래처 후보"(orphan 즐겨찾기)를 거래처로 등록. 상호명은 placeholder 로 넣고
 * 나중에 수정한다. 등록 후 같은 remote_id 의 orphan 즐겨찾기를 붙여 후보 배너에서 지운다.
 */
export async function importPeer(
  input: { remoteId: string; hostname?: string; username?: string; platform?: string; name?: string },
  ctx: { tenantId: string; assignedUserId: string },
) {
  // 운영자가 다이얼로그에 입력한 상호가 있으면 우선, 없으면 hostname → ID placeholder 순.
  const name = input.name?.trim() || (input.hostname ? `신규 거래처 (${input.hostname})` : `신규 거래처 (ID: ${input.remoteId})`);
  const platformNote = input.platform ? `${input.platform}` : "";
  const userNote = input.username ? `사용자: ${input.username}` : "";
  const notes = [platformNote, userNote].filter(Boolean).join(" / ") || null;

  // INSERT 만 try/catch 로 감싼다 — unique 위반 수렴은 여기서만. linkFavorites 는 try 밖으로
  //   빼서 그 실패가 catch 에 unique 수렴으로 오인·흡수돼 "부분성공을 성공으로 위장"하지 않게 한다.
  let row: typeof customers.$inferSelect;
  try {
    const [inserted] = await db
      .insert(customers)
      .values({
        tenantId: ctx.tenantId,
        assignedUserId: ctx.assignedUserId,
        name,
        contactName: null,
        phone: null,
        address: null,
        remoteId: input.remoteId,
        accessPassword: null,
        notes,
      })
      .returning();
    row = inserted;
  } catch (e) {
    // remote_id 전역 unique(011) 위반 = 이미 등록된 거래처. enrollCustomer 와 같은 수렴:
    //   같은 tenant 면 기존 행으로 수렴(중복 레코드 안 만듦, raw 500 방지). 타 tenant 소유거나
    //   unique 아닌 진짜 에러(재조회에도 행 없음)면 throw → jsonError 가 cause 체인으로 409/500 변환.
    const [existing] = await db
      .select()
      .from(customers)
      .where(eq(customers.remoteId, input.remoteId))
      .limit(1);
    if (!existing || existing.tenantId !== ctx.tenantId) throw e;
    row = existing;
  }
  // 신규삽입/기존수렴 어느 경로든 즐겨찾기 링크(멱등). 실패하면 그대로 전파(삼키지 않음).
  await linkFavoritesToCustomer(input.remoteId, row.id, ctx.tenantId);
  return row;
}

// heartbeat 토큰 자가발급 — 거래처 있으면 새 토큰 찍어 반환(멱등 회전).
//   ★H2 봉인(2026-07-07): 라우트가 tenant enroll-key 인증을 통과한 뒤에만 호출하고, 그
//   tenantId 로 스코프한다(remote_id + tenant_id 둘 다 일치해야 발급). tenantId 없는 호출은
//   테넌트 무스코프(옛 동작) — 라우트는 항상 tenantId 를 넘겨 남의 거래처 토큰 발급/회전을 막는다.
export async function registerHeartbeatToken(
  remoteId: string,
  tenantId?: string,
): Promise<string | null> {
  const plaintext = generateHeartbeatToken();
  const where = tenantId
    ? and(eq(customers.remoteId, remoteId), eq(customers.tenantId, tenantId))
    : eq(customers.remoteId, remoteId);
  const [row] = await db
    .update(customers)
    .set({ heartbeatToken: hashHeartbeatToken(plaintext) })
    .where(where)
    .returning({ id: customers.id });
  return row ? plaintext : null;
}

/**
 * Heartbeat 기록 — 토큰 검증 후 last_heartbeat_at + last_version 갱신.
 * remote_id + token 동시 일치하는 customer 없으면 false → route 가 403.
 */
export async function recordHeartbeat(
  remoteId: string,
  token: string,
  version: string,
  machineUuid?: string,
  arch?: string,
  os?: string,
  osBits?: string,
): Promise<boolean> {
  // arch(020)/os·osBits(021): 보내온 경우에만 갱신. 순수 표시·진단 telemetry — WHERE/매칭에는
  //   절대 안 쓴다(신원 키 아님). 값이 없으면 기존 값을 건드리지 않는다.
  const archSet = arch === "x86" || arch === "x64" ? { arch } : {};
  const osSet = os && os.trim() ? { os: os.trim() } : {};
  const osBitsSet = osBits === "x86" || osBits === "x64" ? { osBits } : {};
  const [row] = await db
    .update(customers)
    .set({
      lastHeartbeatAt: new Date(),
      lastVersion: version,
      ...archSet,
      ...osSet,
      ...osBitsSet,
    })
    .where(
      and(
        eq(customers.remoteId, remoteId),
        eq(customers.heartbeatToken, hashHeartbeatToken(token)), // 저장은 해시라 대조도 해시
      ),
    )
    .returning({ id: customers.id });
  if (!row) return false;
  // ★ machine_uuid 앵커 전면 비활성 (2026-07-07). 원래 여기서 지문(machineUuid)을 백필해
  //   "ID 가 바뀌어도 enroll 매칭으로 상호가 따라오게" 했다. 그러나 지문(get_machine_fingerprint)이
  //   기계마다 유니크하지 않아(Win7/폴백이 같은 값 공유) 서로 다른 기계가 같은 지문을 갖고, 그러면
  //   enroll 앵커 매칭이 남의 거래처 레코드를 가로챈다(행복정육식당↔5.5춘천닭갈비, 준코↔처갓집 실사고).
  //   저장 자체를 멈춰 오염을 원천 차단한다. machineUuid 인자는 계약 유지를 위해 남기되 안 쓴다.
  //   신뢰 가능한 지문 소스가 생기면 백필/매칭을 함께 재설계할 것(enrollCustomer step2 참조).
  void machineUuid;
  return true;
}

/**
 * auto-enroll 의 tenant 식별 — agent 가 custom.txt 에 구워온 (slug + enroll-key)로 tenant 를 찾는다.
 * enroll-key 는 sha-256 해시로 tenants.enroll_secret_hash 와 대조(토큰 해시대조와 같은 방식).
 * slug/key 불일치, 비활성 tenant, enroll-secret 미설정이면 null → route 가 403.
 */
export async function resolveTenantByEnroll(
  slug: string,
  enrollKey: string,
): Promise<string | null> {
  if (!slug || !enrollKey) return null;
  const [row] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(
      and(
        eq(tenants.slug, slug),
        eq(tenants.enrollSecretHash, hashHeartbeatToken(enrollKey)), // 저장은 해시라 대조도 해시
        eq(tenants.isActive, true),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * ★키 없는 '첫 토큰 발급' (2026-07-09) — 패널에 관리자가 수동 등록했지만 아직 토큰이 없는
 * 거래처(빈 키 exe 로 설치돼 auto-enroll 못 한 카페리치 등)를 거래처 접촉 없이 살리는 경로.
 *
 * remote_id 만으로 발급한다 — 에이전트의 register_token(chainremote_heartbeat.rs)이 tenantSlug/
 * enrollKey 없이 { remoteId } 만 POST 하기 때문. remote_id 는 tenant 간 unique(마이그 011)라
 * remote_id 하나로 거래처(=tenant)가 유일하게 특정되므로 tenantId 인자가 필요 없고 오발급도 없다.
 *
 * 안전장치 = `heartbeat_token IS NULL` 조건. 이미 토큰을 가진 정당 거래처는 이 경로로 절대
 * 회전(=탈취)되지 않아 H2 위협(임의 remote_id 로 토큰 회전 → 정당 에이전트 축출)을 유지한다.
 * 즉 이 완화는 "관리자가 패널에 등록 + 토큰 미보유" 인 최초 1회만 열린다(회전은 여전히 enroll-key).
 */
export async function registerHeartbeatTokenFirstIssue(
  remoteId: string,
): Promise<string | null> {
  if (!remoteId) return null;
  const plaintext = generateHeartbeatToken();
  const [row] = await db
    .update(customers)
    .set({ heartbeatToken: hashHeartbeatToken(plaintext) })
    .where(
      and(
        eq(customers.remoteId, remoteId),
        isNull(customers.heartbeatToken), // ★첫 발급만 — 이미 토큰 있으면 매칭 0 → null 반환
      ),
    )
    .returning({ id: customers.id });
  return row ? plaintext : null;
}

/**
 * 거래처 agent 자가등록. 인증된 tenant 안에서 remote_id 를 기준으로 분기한다:
 *  - 신규: 거래처 생성 + heartbeat 토큰 발급 (2026-06-29 부터 바로 active, 아래 3) 참고).
 *  - 같은 tenant 기존: 토큰만 회전(재등록/토큰분실 자가복구). enroll_status 는 안 건드려
 *      이미 확정된 거래처를 pending 으로 되돌리지 않는다.
 *  - 다른 tenant 기존: "cross_tenant" 거부. remote_id 글로벌 unique(마이그 011) 위에서
 *      cross-tenant 탈취를 막는다.
 * 동시 enroll 레이스는 unique 위반 catch 후 재조회→회전으로 수렴.
 */
export async function enrollCustomer(
  input: { remoteId: string; name?: string; hostname?: string; machineUuid?: string },
  ctx: { tenantId: string },
): Promise<{ token: string; created: boolean } | "cross_tenant"> {
  const remoteId = input.remoteId.trim();
  // ★ machine_uuid 앵커 전면 비활성 (2026-07-07, recordHeartbeat 주석 참조). 지문이 기계 간
  //   충돌해 남의 레코드를 가로채는 사고(행복정육↔5.5춘천닭갈비 등) → 앵커 매칭/백필 모두 끈다.
  //   아래 step1 백필·step2 매칭·step3 저장이 전부 no-op 이 된다(machineUuid=undefined).
  void input.machineUuid;
  const machineUuid: string | undefined = undefined;
  const plaintext = generateHeartbeatToken();
  const tokenHash = hashHeartbeatToken(plaintext);

  // 1) remote_id(전역 unique)로 기존 행 확인. ID 가 안 바뀐 경우(재enroll, 또는 같은 랜카드라
  //    MAC 재계산 결과 ID 동일)가 여기 걸린다. 토큰 회전은 필수, 지문 갱신은 best-effort.
  const [existing] = await db
    .select({ id: customers.id, tenantId: customers.tenantId })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  if (existing) {
    if (existing.tenantId !== ctx.tenantId) return "cross_tenant";
    await db
      .update(customers)
      .set({ heartbeatToken: tokenHash })
      .where(eq(customers.id, existing.id));
    if (machineUuid) {
      // 지문 백필/갱신(포맷 등으로 MachineGuid 바뀐 경우). 토큰 쿼리와 분리해 드문 unique 충돌이 나도 토큰은 보장.
      await db
        .update(customers)
        .set({ machineUuid })
        .where(eq(customers.id, existing.id))
        .catch(() => {});
    }
    return { token: plaintext, created: false };
  }

  // 2) 기기지문 앵커 — remote_id 는 안 맞지만 machine_uuid 가 같으면 ID 가 바뀐 것이다
  //    (UUID_MISMATCH→update_id, 또는 랜카드 교체). 그 거래처의 remote_id 만 새 값으로 바꿔
  //    상호·담당·즐겨찾기를 유지한다(Chang 핵심요구). user_favorites.remote_id 도 같이 갱신해
  //    HQ 가 죽은 옛 ID 를 가리키지 않게 한다.
  if (machineUuid) {
    const [byMachine] = await db
      .select({ id: customers.id, remoteId: customers.remoteId })
      .from(customers)
      .where(and(eq(customers.machineUuid, machineUuid), eq(customers.tenantId, ctx.tenantId)))
      .limit(1);
    if (byMachine) {
      const oldRemoteId = byMachine.remoteId;
      try {
        await db
          .update(customers)
          .set({ remoteId, heartbeatToken: tokenHash, updatedAt: new Date() })
          .where(eq(customers.id, byMachine.id));
        if (oldRemoteId && oldRemoteId !== remoteId) {
          await db
            .update(userFavorites)
            .set({ remoteId })
            .where(and(eq(userFavorites.remoteId, oldRemoteId), eq(userFavorites.tenantId, ctx.tenantId)));
        }
        return { token: plaintext, created: false };
      } catch {
        // 새 remote_id 를 이미 다른 거래처가 점유(드문 이중충돌) → remote_id 변경은 포기하고 토큰만 회전.
        //   에이전트가 다음 UUID_MISMATCH 에서 또 다른 ID 로 재시도해 수렴한다.
        await db
          .update(customers)
          .set({ heartbeatToken: tokenHash })
          .where(eq(customers.id, byMachine.id));
        return { token: plaintext, created: false };
      }
    }
  }

  // 3) 신규 — 바로 정식 거래처(active)로 등록. 2026-06-29 Chang 결정: 설치 시 상호 입력은 등록
  //   의사이고 설치파일이 per-tenant enroll-key 라 아무나 못 넣으므로 "후보→확인" 이중작업은 불필요.
  //   과금은 패널 밖에서 따로 관리, 잘못/테스트 설치는 삭제로 처리한다.
  //   (옛 'pending 후보 + 확인' 흐름 폐기. 상호 없으면 importPeer 와 같은 placeholder 규칙.)
  const name =
    input.name?.trim() ||
    (input.hostname?.trim()
      ? `신규 거래처 (${input.hostname.trim()})`
      : `신규 거래처 (ID: ${remoteId})`);
  try {
    const [row] = await db
      .insert(customers)
      .values({
        tenantId: ctx.tenantId,
        name,
        remoteId,
        enrollStatus: "active",
        heartbeatToken: tokenHash,
        ...(machineUuid ? { machineUuid } : {}),
      })
      .returning({ id: customers.id });
    await linkFavoritesToCustomer(remoteId, row.id, ctx.tenantId);
    return { token: plaintext, created: true };
  } catch (e) {
    // 동시 enroll 레이스 — 방금 다른 요청이 같은 remote_id 를 먼저 넣음(uq_customers_remote_id 위반).
    //   재조회 후 토큰 회전으로 수렴. 행이 여전히 없으면 unique 아닌 에러라 재throw.
    const [row] = await db
      .select({ id: customers.id, tenantId: customers.tenantId })
      .from(customers)
      .where(eq(customers.remoteId, remoteId))
      .limit(1);
    if (!row) throw e;
    if (row.tenantId !== ctx.tenantId) return "cross_tenant";
    await db
      .update(customers)
      .set({ heartbeatToken: tokenHash })
      .where(eq(customers.id, row.id));
    return { token: plaintext, created: false };
  }
}

/** 자가등록 후보 거래처 확정 — enroll_status 'pending'→'active'. HQ 가 패널에서 '확인' 클릭.
 *  이미 active 거나 다른 tenant 면 무변경(false).
 *  (현재 pending 도 일괄푸시 대상이라 업뎃 게이트는 아님 — pending-updates.ts 참고.) */
export async function confirmEnrollment(
  id: string,
  ctx: { tenantId: string },
): Promise<boolean> {
  const [row] = await db
    .update(customers)
    .set({ enrollStatus: "active", updatedAt: new Date() })
    .where(
      and(
        eq(customers.id, id),
        eq(customers.tenantId, ctx.tenantId),
        eq(customers.enrollStatus, "pending"),
      ),
    )
    .returning({ id: customers.id });
  return !!row;
}

/** confirmEnrollment 의 remote_id 버전 — HQ '전체 거래처' 탭에서 마스터가 9자리 ID 로 확정.
 *  remote_id 는 테넌트 내 unique 라 최대 1행. 이미 active, 다른 tenant, 미등록이면 무변경(false). */
export async function confirmEnrollmentByRemoteId(
  remoteId: string,
  ctx: { tenantId: string },
): Promise<boolean> {
  const [row] = await db
    .update(customers)
    .set({ enrollStatus: "active", updatedAt: new Date() })
    .where(
      and(
        eq(customers.remoteId, remoteId),
        eq(customers.tenantId, ctx.tenantId),
        eq(customers.enrollStatus, "pending"),
      ),
    )
    .returning({ id: customers.id });
  return !!row;
}

/** HQ 어느 직원이든 거래처명을 바꾸면 패널 DB(진실 원천)에 기록 → 최근/즐겨찾기/패널/전 직원이 일관.
 *  remote_id 로 찾아 갱신. 미등록(orphan) remote_id 면 무변경(false) → HQ 는 로컬 alias 를 유지. */
export async function renameCustomerByRemoteId(
  remoteId: string,
  name: string,
  ctx: { tenantId: string },
): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const [row] = await db
    .update(customers)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(customers.remoteId, remoteId), eq(customers.tenantId, ctx.tenantId)))
    .returning({ id: customers.id });
  return !!row;
}

// 차지(claim)는 "즐겨찾기 = 차지" 로 일원화 — favorites.ts addFavoriteByRemoteId 가 미배정
//    거래처를 즐겨찾기하면 자동으로 담당 배정(first-wins). 원격 접속 자체는 소유와 무관.
//    (옛 connect-time claim 프리미티브는 1.4.41 에서 폐기.)
