// 거래처 데이터 레이어 — Server Actions(패널 UI) 와 REST API(데스크톱 앱) 가 공유.
// 프레임워크 의존 없음(revalidatePath/redirect 없음) — 후처리는 호출 측 몫.
// 모든 함수는 tenantId 격리 강제. 호출자는 자기 세션의 tenantId 만 넘긴다.

import { and, desc, eq, getTableColumns, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerAlerts, customers, folders, tenants, userFavorites } from "@/lib/schema";
import { linkFavoritesToCustomer } from "@/lib/data/favorites";
import { generateHeartbeatToken, hashHeartbeatToken } from "@/lib/heartbeat-token";
import { autoQueueIfBehind } from "@/lib/data/pending-updates";
import { getAgentPushMetaCached } from "@/lib/agent-push-meta";
import { maskUnverifiedDoor } from "@/lib/data/upnp-probe";

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
  // 폴더(마이그 026) — 폼이 folderName 을 createFolder(findOrCreate)로 풀어 여기에 folderId 를
  //   세팅한다. assignedUserId 처럼 undefined 면 update .set 에서 무시돼 기존 폴더가 보존된다
  //   (folderName 을 안 보내는 HQ API 경로). 빈 폴더명이면 null(해제).
  folderId?: string | null;
}

export async function listCustomers(tenantId: string) {
  // 폴더명을 folder_id 로 조인해 함께 낸다(folderName). HQ 는 이 값을 device_group_name 으로
  //   받아 폴더로 묶는다. 폴더 미배정이면 leftJoin 으로 folderName=null.
  const rows = await db
    .select({ ...getTableColumns(customers), folderName: folders.name })
    .from(customers)
    .leftJoin(folders, eq(folders.id, customers.folderId))
    .where(eq(customers.tenantId, tenantId))
    .orderBy(desc(customers.updatedAt));
  // ★검증 못 한 UPnP 주소는 여기서 지운다(마이그042). 공유기가 매핑을 등록해 놓고도 실제로는
  //   랜 안쪽으로 넘기지 않는 경우가 있어(우리집 실측), 그대로 내주면 본사 앱이 원격마다
  //   죽은 주소를 후보로 잡는다. 본사 앱은 손댈 필요가 없다 — 주소가 없으면 안 쓴다.
  return rows.map(maskUnverifiedDoor);
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

// 거래처 삭제 — 즐겨찾기 잔재까지 같이 지운다.
//
// ★2026-08-05 실사고: 봉스푸드(포스가 없어져 삭제)가 다음 화면에서 "신규 거래처 후보
//   이름 미상"으로 되살아났다. user_favorites.customer_id 의 FK 가 onDelete:"set null"
//   이라, 거래처를 지우면 즐겨찾기 행은 남고 customer_id 만 NULL 이 된다. 그런데
//   listOrphanFavorites 는 "customer_id IS NULL" 을 곧 "아직 등록 안 된 신규 후보"로
//   읽으므로, 방금 지운 거래처가 후보로 부활한다 — 지운 사람 입장에선 삭제가 안 먹은 것.
//   삭제는 "이 기기를 우리 목록에서 뺀다"는 뜻이므로 즐겨찾기도 같이 걷어낸다.
//   (같은 기기가 나중에 재설치되면 auto-enroll 로 pending 거래처가 되는 정상 경로를 탄다.)
export async function deleteCustomer(id: string, ctx: { tenantId: string }) {
  return await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: customers.id, remoteId: customers.remoteId })
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
      .limit(1);
    if (!target) return false;

    // remote_id 로도 지운다 — 즐겨찾기가 customer_id 없이 remote_id 만 들고 있는
    // 경우(직원이 거래처 등록 전에 즐겨찾기한 뒤 나중에 등록된 행)까지 걷어내야
    // 부활 경로가 완전히 막힌다.
    await tx
      .delete(userFavorites)
      .where(
        and(
          eq(userFavorites.tenantId, ctx.tenantId),
          target.remoteId
            ? or(
                eq(userFavorites.customerId, id),
                eq(userFavorites.remoteId, target.remoteId),
              )
            : eq(userFavorites.customerId, id),
        ),
      );

    const result = await tx
      .delete(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
      .returning({ id: customers.id });
    return result.length > 0;
  });
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
export interface HeartbeatExtras {
  // 디스크 관제(024) — 바이트 단위. 유효 양수일 때만 반영.
  diskTotal?: number;
  diskFree?: number;
  tempBytes?: number;
  // 에이전트의 정리 완료 보고(JSON 문자열) — 저장하고 정리 요청 큐를 비운다.
  cleanupResult?: string;
  // 방화벽 관제(028) — 에이전트 보고. firewallEnabled=현재 방화벽 켜짐 여부(표시용),
  //   firewallDisarmed=이번 heartbeat 직전에 자동 해제했나(참이면 disarm_count++, 잦으면 업뎃 잦음 신호).
  firewallEnabled?: boolean;
  firewallDisarmed?: boolean;
  // VAN 데몬 관제(036) — vanOk=데몬이 포트를 듣고 있나(표시용), vanRestarted=이번 heartbeat
  //   직전에 되살렸나(참이면 restart_count++), vanGaveUp=재실행으로 안 낫아 손 뗌(사람 호출).
  vanOk?: boolean;
  vanRestarted?: boolean;
  vanGaveUp?: boolean;
  // 데몬이 그 기기에 아예 없음(037) — 다른 VAN 거래처에 잘못 켠 경우. 조치가 달라 따로 받는다.
  vanMissing?: boolean;
  // NAT 유형(039) — 0=미상 1=Cone 2=Symmetric. 유효값일 때만 반영.
  natType?: number;
  // 공유기 UPnP(040) — 'no'|'found'|'yes' 만 통과.
  upnp?: string;
  // 공유기가 열어 준 바깥 주소(041) "ip:port". 빈 문자열이면 닫힌 것으로 보고 지운다.
  upnpEndpoint?: string;
}

export async function recordHeartbeat(
  remoteId: string,
  token: string,
  version: string,
  machineUuid?: string,
  arch?: string,
  os?: string,
  osBits?: string,
  extras?: HeartbeatExtras,
): Promise<boolean> {
  // arch(020)/os·osBits(021)/디스크(024): 보내온 경우에만 갱신. 순수 표시·진단 telemetry —
  //   WHERE/매칭에는 절대 안 쓴다(신원 키 아님). 값이 없으면 기존 값을 건드리지 않는다.
  const archSet = arch === "x86" || arch === "x64" ? { arch } : {};
  // os 는 자유 문자열(표시용) — arch/osBits 화이트리스트와 달리 초대형/저장남용 여지가 있어
  //   64자로 자른다(악성 클라가 유효 토큰 1개로 거대 문자열을 밀어넣는 것 차단).
  const osSet = os && os.trim() ? { os: os.trim().slice(0, 64) } : {};
  const osBitsSet = osBits === "x86" || osBits === "x64" ? { osBits } : {};
  // 디스크 값 검증 — bigint 컬럼이라 상한을 둬 오버플로우 500 을 막고(1e19 등 이상값),
  //   diskTotal 은 물리적으로 항상 >0 이라 0/음수를 이상값으로 걸러 기존 telemetry 를
  //   0 으로 덮어쓰지 않는다. diskFree/tempBytes 는 0 허용(가득참/temp 없음). 소수는 floor.
  const MAX_DISK = 1e15; // 1PB — 현실 상한 겸 bigint 안전 범위.
  const posNum = (v: unknown, allowZero: boolean) =>
    typeof v === "number" &&
    Number.isFinite(v) &&
    (allowZero ? v >= 0 : v > 0) &&
    v <= MAX_DISK
      ? Math.floor(v)
      : undefined;
  const diskTotal = posNum(extras?.diskTotal, false);
  const diskFree = posNum(extras?.diskFree, true);
  const tempBytes = posNum(extras?.tempBytes, true);
  const diskSet =
    diskTotal !== undefined && diskFree !== undefined
      ? {
          diskTotalBytes: diskTotal,
          diskFreeBytes: diskFree,
          diskReportedAt: new Date(),
          ...(tempBytes !== undefined ? { tempBytes } : {}),
        }
      : {};
  // 정리 완료 보고 — 결과 저장 + 요청 큐 클리어. 단, 이 결과가 실제로 충족한 요청만 비운다.
  //   에이전트가 T1 을 실행하는 사이 운영자가 재클릭(T2)하면, 뒤늦게 도착한 T1 결과 보고가
  //   T2 요청까지 지워 명령이 유실됐다(disk-01). result.at(완료 시각) 이후에 들어온 더 새로운
  //   요청(cleanup_requested_at > 완료시각)은 살려 둔다. at 이 없으면(옛 에이전트) now 로 대체.
  let cleanupSet: Record<string, unknown> = {};
  const cleanupResult = extras?.cleanupResult?.trim();
  if (cleanupResult) {
    let doneAt = new Date();
    try {
      const parsed = JSON.parse(cleanupResult);
      if (parsed && typeof parsed.at === "string") {
        const d = new Date(parsed.at);
        if (!Number.isNaN(d.getTime())) doneAt = d;
      }
    } catch {
      // at 파싱 실패 — now 로 진행(대개 요청이 과거라 정상 클리어).
    }
    cleanupSet = {
      cleanupResult,
      cleanupRequestedAt: sql`CASE WHEN ${customers.cleanupRequestedAt} <= ${doneAt} THEN NULL ELSE ${customers.cleanupRequestedAt} END`,
    };
  }
  // 방화벽 상태 반영 — 현재 켜짐 여부(표시용) + 이번에 자동 해제했으면 카운트/시각 갱신.
  const firewallSet: Record<string, unknown> = {};
  if (typeof extras?.firewallEnabled === "boolean") {
    firewallSet.firewallEnabled = extras.firewallEnabled;
  }
  if (extras?.firewallDisarmed) {
    firewallSet.firewallDisarmCount = sql`${customers.firewallDisarmCount} + 1`;
    firewallSet.firewallLastDisarmAt = new Date();
  }
  // VAN 데몬 상태 반영 — 현재 정상 여부 + 이번에 되살렸으면 카운트/시각 갱신.
  //   ★관제를 켠 거래처에서만 반영한다. 에이전트는 heartbeat 응답을 받아야 관제가 꺼진 걸
  //   알기 때문에, 끄기 직전에 출발한 마지막 보고가 뒤늦게 도착한다. 그걸 그대로 저장하면
  //   방금 지운 '복구 실패'가 되살아나 관제를 껐는데도 빨간 줄이 남는다(2026-08-10 삼성공판장
  //   실측). 그 한 번의 시차는 서버가 막아야 한다 — van_watch 가 비었으면 뭐가 오든 비운다.
  const watched = sql`${customers.vanWatch} IS NOT NULL`;
  const vanSet: Record<string, unknown> = {};
  // ::boolean 캐스트가 필요하다 — CASE 안의 바인딩 파라미터는 타입이 정해지지 않아
  //   Postgres 가 42804(datatype mismatch)로 거절한다.
  if (typeof extras?.vanOk === "boolean") {
    vanSet.vanOk = sql`CASE WHEN ${watched} THEN ${extras.vanOk}::boolean ELSE NULL::boolean END`;
  }
  if (typeof extras?.vanGaveUp === "boolean") {
    vanSet.vanGaveUp = sql`CASE WHEN ${watched} THEN ${extras.vanGaveUp}::boolean ELSE false END`;
  }
  if (typeof extras?.vanMissing === "boolean") {
    vanSet.vanMissing = sql`CASE WHEN ${watched} THEN ${extras.vanMissing}::boolean ELSE false END`;
  }
  if (extras?.vanRestarted) {
    vanSet.vanRestartCount = sql`CASE WHEN ${watched} THEN ${customers.vanRestartCount} + 1 ELSE ${customers.vanRestartCount} END`;
    vanSet.vanLastRestartAt = sql`CASE WHEN ${watched} THEN now() ELSE ${customers.vanLastRestartAt} END`;
  }
  // NAT 유형 — 0/1/2 만 통과(이상값은 무시해 통계를 오염시키지 않는다).
  const upnpSet: Record<string, unknown> =
    typeof extras?.upnp === "string" && ["no", "found", "yes"].includes(extras.upnp)
      ? { upnp: extras.upnp }
      : {};
  // 열린 주소 — 형식이 맞을 때만 반영하고, 빈 문자열은 "닫혔다"는 보고라 NULL 로 지운다.
  //   (에이전트가 매핑에 실패하거나 스위치가 꺼지면 빈 값을 보낸다.)
  const endpointSet: Record<string, unknown> =
    typeof extras?.upnpEndpoint === "string"
      ? {
          upnpEndpoint: /^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/.test(extras.upnpEndpoint)
            ? extras.upnpEndpoint
            : null,
        }
      : {};
  const natSet: Record<string, unknown> =
    typeof extras?.natType === "number" && [0, 1, 2].includes(extras.natType)
      ? { natType: extras.natType }
      : {};
  const [row] = await db
    .update(customers)
    .set({
      lastHeartbeatAt: new Date(),
      lastVersion: version,
      ...archSet,
      ...osSet,
      ...osBitsSet,
      ...diskSet,
      ...cleanupSet,
      ...firewallSet,
      ...vanSet,
      ...natSet,
      ...upnpSet,
      ...endpointSet,
    })
    .where(
      and(
        eq(customers.remoteId, remoteId),
        eq(customers.heartbeatToken, hashHeartbeatToken(token)), // 저장은 해시라 대조도 해시
      ),
    )
    .returning({
      id: customers.id,
      tenantId: customers.tenantId,
      isInternal: customers.isInternal,
    });
  if (!row) return false;
  // 자동 롤아웃(2026-07-20) — 구버전 보고면 이 자리에서 업데이트 큐잉. 최신이면 문자열 비교
  // 한 번으로 끝(추가 DB 비용 0). 실패해도 heartbeat 는 안 깨진다.
  try {
    const meta = await getAgentPushMetaCached();
    await autoQueueIfBehind(
      { id: row.id, tenantId: row.tenantId, isInternal: row.isInternal },
      version,
      meta,
    );
  } catch {
    // 자동 큐잉 실패는 heartbeat 성패와 무관 — 다음 tick 재시도.
  }
  // ★ machine_uuid 앵커 전면 비활성 (2026-07-07). 원래 여기서 지문(machineUuid)을 백필해
  //   "ID 가 바뀌어도 enroll 매칭으로 상호가 따라오게" 했다. 그러나 지문(get_machine_fingerprint)이
  //   기계마다 유니크하지 않아(Win7/폴백이 같은 값 공유) 서로 다른 기계가 같은 지문을 갖고, 그러면
  //   enroll 앵커 매칭이 남의 거래처 레코드를 가로챈다(행복정육식당↔5.5춘천닭갈비, 준코↔처갓집 실사고).
  //   저장 자체를 멈춰 오염을 원천 차단한다. machineUuid 인자는 계약 유지를 위해 남기되 안 쓴다.
  //   신뢰 가능한 지문 소스가 생기면 백필/매칭을 함께 재설계할 것(enrollCustomer step2 참조).
  void machineUuid;
  return true;
}

/** heartbeat 응답에 실을 정리 요청 시각 — 없으면 null. (요청이 살아있는 동안 매 heartbeat
 *  마다 같은 값이 내려가고, 에이전트는 "마지막으로 실행한 요청 시각"과 달라야만 실행한다.) */
export async function getCleanupRequest(remoteId: string): Promise<string | null> {
  const [row] = await db
    .select({ at: customers.cleanupRequestedAt })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return row?.at ? row.at.toISOString() : null;
}

/** heartbeat 응답용 — 이 거래처가 방화벽 자동 해제 대상인지(에이전트가 감시 여부 결정). */
export async function getFirewallControl(remoteId: string): Promise<boolean> {
  const [row] = await db
    .select({ on: customers.firewallControl })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return row?.on ?? false;
}

/** HQ 관제 다이얼로그용 — 이 거래처의 현재 관제 설정·상태.
 *  HQ 의 로컬 peer 캐시(최근 세션 탭)에는 이 값들이 없어 "꺼짐"으로 오독된다. 그래서
 *  다이얼로그는 캐시를 믿지 않고 여기로 직접 묻는다. 자기 tenant 거래처만. */
export async function getWatchState(remoteId: string, tenantId: string) {
  const [row] = await db
    .select({
      firewallControl: customers.firewallControl,
      vanWatch: customers.vanWatch,
      vanOk: customers.vanOk,
      vanGaveUp: customers.vanGaveUp,
      vanMissing: customers.vanMissing,
      vanRestartCount: customers.vanRestartCount,
      upnpEnabled: customers.upnpEnabled,
      upnpEndpoint: customers.upnpEndpoint,
      upnpVerifiedAt: customers.upnpVerifiedAt,
      upnp: customers.upnp,
    })
    .from(customers)
    .where(and(eq(customers.remoteId, remoteId), eq(customers.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

/** heartbeat 응답용 — 이 거래처에서 감시할 VAN 데몬 종류(빈 문자열이면 관제 off). */
export async function getVanWatch(remoteId: string): Promise<string> {
  const [row] = await db
    .select({ kind: customers.vanWatch })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return (row?.kind ?? "").trim();
}

/** heartbeat 응답용 — 이 거래처를 관리하는 대리점의 상호(거래처 수락창에 뜰 이름).
 *  support_display_name 이 비면 계정 표시명으로 폴백한다. 설치본이 아니라 이 경로로
 *  내려보내는 이유: 설치본(custom.txt)은 자동 업데이트 때 번들 파일로 덮여 사라지고,
 *  대리점이 상호를 바꿔도 이미 깔린 곳에 반영할 길이 없다. */
export async function getSupportName(remoteId: string): Promise<string | null> {
  const [row] = await db
    .select({
      support: tenants.supportDisplayName,
      display: tenants.displayName,
    })
    .from(customers)
    .innerJoin(tenants, eq(customers.tenantId, tenants.id))
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  if (!row) return null;
  const name = (row.support ?? "").trim() || (row.display ?? "").trim();
  return name || null;
}

/** HQ 우클릭 "방화벽 설정" — 이 거래처의 방화벽 자동 해제 on/off. 자기 tenant 거래처만. */
/** 에이전트가 heartbeat 응답으로 받는 "포트를 열어도 되는가". 켜진 거래처만 연다. */
export async function getUpnpEnabled(remoteId: string): Promise<boolean> {
  const [row] = await db
    .select({ on: customers.upnpEnabled })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  return row?.on ?? false;
}

/** HQ 우클릭 "공유기 포트 열기" — 자기 tenant 거래처만. 끄면 열린 주소도 같이 지운다
 *  (닫혔는데 옛 주소가 남아 있으면 본사가 없는 문을 계속 두드린다). */
export async function setUpnpEnabled(
  remoteId: string,
  on: boolean,
  tenantId: string,
): Promise<boolean> {
  const [row] = await db
    .update(customers)
    // 끄면 주소와 검증 기록을 같이 지운다 — 남겨 두면 다음에 켰을 때 옛 검증이 살아 있는
    //   것처럼 보여, 새로 안 열린 문을 열린 것으로 센다.
    .set({
      upnpEnabled: on,
      ...(on ? {} : { upnpEndpoint: null, upnpVerifiedAt: null, upnpProbeAt: null }),
    })
    .where(and(eq(customers.remoteId, remoteId), eq(customers.tenantId, tenantId)))
    .returning({ id: customers.id });
  return !!row;
}

export async function setFirewallControl(
  remoteId: string,
  on: boolean,
  tenantId: string,
): Promise<boolean> {
  const [row] = await db
    .update(customers)
    .set({ firewallControl: on })
    .where(and(eq(customers.remoteId, remoteId), eq(customers.tenantId, tenantId)))
    .returning({ id: customers.id });
  return !!row;
}

/** HQ 우클릭 "카드결제 데몬 관제" — 감시할 VAN 종류 설정(빈 문자열이면 관제 해제).
 *  자기 tenant 거래처만. 종류를 바꾸면 누적/포기 상태를 초기화한다 — 다른 VAN 의 이력을
 *  그대로 물려받으면 숫자가 거짓이 된다. */
export async function setVanWatch(
  remoteId: string,
  kind: string,
  tenantId: string,
): Promise<boolean> {
  const k = kind.trim();
  const [row] = await db
    .update(customers)
    .set({
      vanWatch: k || null,
      vanOk: null,
      vanGaveUp: false,
      vanMissing: false,
      vanRestartCount: 0,
      vanLastRestartAt: null,
    })
    .where(and(eq(customers.remoteId, remoteId), eq(customers.tenantId, tenantId)))
    .returning({ id: customers.id });
  return !!row;
}

/** [디스크 정리] 버튼 — 정리 명령 큐잉. 에이전트가 다음 heartbeat(≤10분)에 받아 실행한다. */
export async function requestCleanup(
  remoteId: string,
  ctx: { tenantId: string },
): Promise<boolean> {
  const [row] = await db
    .update(customers)
    .set({ cleanupRequestedAt: new Date() })
    .where(
      and(eq(customers.remoteId, remoteId), eq(customers.tenantId, ctx.tenantId)),
    )
    .returning({ id: customers.id });
  return !!row;
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

/** 상호 정규화 키 — 매칭 전용(표시 아님). NFKC + 소문자 + 공백 전부 제거.
 *  "태조산 메인" == "태조산메인". 글자가 다르면(오타/지점명) 일부러 안 붙는다 —
 *  잘못 붙는 사고(엉뚱한 매장에 기기 연결)가 안 붙는 것보다 훨씬 위험하다. */
export function normalizeCustomerNameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

// 기기 생존 판정 — heartbeat 10분 주기 + 여유. 패널 오프라인 경고(15분)와 같은 임계값.
const DEVICE_ALIVE_MS = 15 * 60_000;
function deviceAlive(lastHeartbeatAt: Date | null): boolean {
  return (
    !!lastHeartbeatAt &&
    Date.now() - new Date(lastHeartbeatAt).getTime() < DEVICE_ALIVE_MS
  );
}

/**
 * 자가등록(auto-enroll) — "상호 = 교체 키" 판정 매트릭스 (2026-07-14 재설계).
 *
 * 설치 시 항상 상호를 입력하는 단일 룰을 전제로, 서버가 기기ID·상호 조합으로 판정한다:
 *   ID 일치 + 상호 일치(정규화)  → 재설치/포맷 — 토큰만 회전 (아무 일 없음)
 *   ID 일치 + 다른 매장 상호     → 기기 이동 — 그 매장으로 기기를 옮김 (이력·이름 보존)
 *   ID 신규 + 기존 매장 상호     → 기기 교체 — 그 거래처에 새 기기 연결 (즐겨찾기 이전)
 *   애매(오타/대상 기기 생존/동명 다수) → 조용히 안 바꾸고 customer_alerts 로 마스터에게
 *
 * 자동 이동/교체는 대상 거래처의 기존 기기가 죽어있을 때만(안전핀 — 동명 매장·멀티포스 보호).
 * machine_uuid 앵커는 클론이미지 지문충돌 사고(2026-07-07)로 전면 비활성 유지.
 */
export async function enrollCustomer(
  input: { remoteId: string; name?: string; hostname?: string; machineUuid?: string },
  ctx: { tenantId: string },
): Promise<{ token: string; created: boolean } | "cross_tenant"> {
  const remoteId = input.remoteId.trim();
  void input.machineUuid; // 앵커 비활성 (enroll-anchor.test 경보 대상)
  const plaintext = generateHeartbeatToken();
  const tokenHash = hashHeartbeatToken(plaintext);
  const explicitName = input.name?.trim() ?? "";
  const nameKey = explicitName ? normalizeCustomerNameKey(explicitName) : "";

  // 1) remote_id(전역 unique)로 기존 행 확인 — 같은 기기의 재enroll.
  const [byId] = await db
    .select({
      id: customers.id,
      tenantId: customers.tenantId,
      name: customers.name,
    })
    .from(customers)
    .where(eq(customers.remoteId, remoteId))
    .limit(1);
  if (byId && byId.tenantId !== ctx.tenantId) return "cross_tenant";

  // 상호 매칭 후보 — 자기 tenant 안에서만, 자기 자신(byId) 제외. 정규화 키 일치가 정확히
  // 1건일 때만 자동 액션 후보(동명 다수 = 애매 → 사람에게).
  let byName: {
    id: string;
    name: string;
    remoteId: string | null;
    lastHeartbeatAt: Date | null;
  } | null = null;
  let byNameCount = 0;
  if (nameKey) {
    const rows = await db
      .select({
        id: customers.id,
        name: customers.name,
        remoteId: customers.remoteId,
        lastHeartbeatAt: customers.lastHeartbeatAt,
      })
      .from(customers)
      .where(eq(customers.tenantId, ctx.tenantId));
    const matches = rows.filter(
      (r) =>
        (!byId || r.id !== byId.id) &&
        r.name &&
        normalizeCustomerNameKey(r.name) === nameKey,
    );
    byNameCount = matches.length;
    if (matches.length === 1) byName = matches[0];
  }

  if (byId) {
    const sameName =
      !nameKey || (byId.name && normalizeCustomerNameKey(byId.name) === nameKey);
    if (sameName) {
      // 재설치/포맷/무명(옛 빌드) — 토큰만 회전. 매번 상호를 넣어도 무해한 이유.
      await db
        .update(customers)
        .set({ heartbeatToken: tokenHash })
        .where(eq(customers.id, byId.id));
      return { token: plaintext, created: false };
    }

    if (byName && !deviceAlive(byName.lastHeartbeatAt)) {
      // 기기 이동 — 이 기기가 다른(기기 죽은) 매장 상호로 설치됨. 옛 매장 행은 기기만 떼고
      // 보존(이력 유지), 즐겨찾기는 기기를 따라가되 소속 거래처를 갱신.
      const target = byName;
      await db.transaction(async (tx) => {
        await tx
          .update(customers)
          .set({ remoteId: null, heartbeatToken: null })
          .where(eq(customers.id, byId.id));
        await tx
          .update(customers)
          .set({ remoteId, heartbeatToken: tokenHash, updatedAt: new Date() })
          .where(eq(customers.id, target.id));
        await tx
          .update(userFavorites)
          .set({ customerId: target.id })
          .where(
            and(
              eq(userFavorites.remoteId, remoteId),
              eq(userFavorites.tenantId, ctx.tenantId),
            ),
          );
        await tx.insert(customerAlerts).values({
          tenantId: ctx.tenantId,
          customerId: target.id,
          type: "device_moved",
          detail: JSON.stringify({
            remoteId,
            from: byId.name,
            to: target.name,
          }),
          resolvedAt: new Date(), // 자동 성립 — 감사 로그
        });
      });
      return { token: plaintext, created: false };
    }

    // 애매 — 상호가 아무 데도 안 맞거나(오타/신규 매장명), 대상 기기가 살아있거나, 동명 다수.
    // 조용히 아무것도 안 바꾸고(기기·이름 유지, 토큰만 회전) 마스터 결정 큐에 올린다.
    await db
      .update(customers)
      .set({ heartbeatToken: tokenHash })
      .where(eq(customers.id, byId.id));
    const [dup] = await db
      .select({ id: customerAlerts.id })
      .from(customerAlerts)
      .where(
        and(
          eq(customerAlerts.tenantId, ctx.tenantId),
          eq(customerAlerts.customerId, byId.id),
          eq(customerAlerts.type, "reinstalled_new_name"),
          isNull(customerAlerts.resolvedAt),
        ),
      )
      .limit(1);
    if (!dup) {
      // 재enroll 이 반복돼도 미해결 알림은 1건만 (스팸 방지).
      await db.insert(customerAlerts).values({
        tenantId: ctx.tenantId,
        customerId: byId.id,
        type: "reinstalled_new_name",
        detail: JSON.stringify({
          remoteId,
          currentName: byId.name,
          newName: explicitName,
          reason: byNameCount > 1 ? "동명 다수" : byName ? "대상 기기 사용 중" : "일치 상호 없음",
        }),
      });
    }
    return { token: plaintext, created: false };
  }

  // 2) 미지의 기기 ID + 기존 매장 상호(기기 없음/죽음) = 기기 교체.
  if (byName && !deviceAlive(byName.lastHeartbeatAt)) {
    const target = byName;
    const oldRemoteId = target.remoteId;
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(customers)
          .set({ remoteId, heartbeatToken: tokenHash, updatedAt: new Date() })
          .where(eq(customers.id, target.id));
        if (oldRemoteId && oldRemoteId !== remoteId) {
          // 즐겨찾기가 죽은 옛 기기 ID 를 가리키지 않게 새 기기로 이전.
          await tx
            .update(userFavorites)
            .set({ remoteId })
            .where(
              and(
                eq(userFavorites.remoteId, oldRemoteId),
                eq(userFavorites.tenantId, ctx.tenantId),
              ),
            );
        }
        await tx.insert(customerAlerts).values({
          tenantId: ctx.tenantId,
          customerId: target.id,
          type: "device_replaced",
          detail: JSON.stringify({ from: oldRemoteId, to: remoteId, name: target.name }),
          resolvedAt: new Date(), // 자동 성립 — 감사 로그
        });
      });
      return { token: plaintext, created: false };
    } catch {
      // remote_id unique 레이스(동시 enroll) 등 — 아래 신규 생성/수습 경로로 계속.
    }
  }

  // 3) 신규 — 바로 정식 거래처(active)로 등록. 2026-06-29 Chang 결정: 설치 시 상호 입력은 등록
  //   의사이고 설치파일이 per-tenant enroll-key 라 아무나 못 넣으므로 "후보→확인" 이중작업은 불필요.
  //   (상호 없으면 importPeer 와 같은 placeholder 규칙.)
  const name =
    explicitName ||
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
      })
      .returning({ id: customers.id });
    await linkFavoritesToCustomer(remoteId, row.id, ctx.tenantId);
    if (byNameCount > 0) {
      // 동일 상호 거래처가 이미 있는데(기기 생존/다수) 새 기기로 또 등록됨 — 동명 매장이거나
      // 멀티포스(메인+오더). 자동 병합은 위험하니 배지로만 알린다.
      await db.insert(customerAlerts).values({
        tenantId: ctx.tenantId,
        customerId: row.id,
        type: "same_name_new_device",
        detail: JSON.stringify({ remoteId, name: explicitName }),
      });
    }
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

/** 연결 경로 점검 결과 기록(마이그043) — HQ 가 한 바퀴 돌고 올린다.
 *
 *  ★자기 tenant 거래처만 갱신한다. 결과는 덮어쓴다 — 최신 한 벌만 의미가 있고, 이력이
 *  필요해지면 그때 별도 테이블을 판다(지금은 명단을 뽑는 게 목적이라 이력이 필요 없다). */
export async function recordProbeResults(
  tenantId: string,
  rows: { remoteId: string; direct: boolean | null; ms: number }[],
): Promise<number> {
  let n = 0;
  for (const r of rows) {
    const id = (r.remoteId ?? "").trim();
    if (!id) continue;
    const res = await db
      .update(customers)
      .set({
        probeDirect: r.direct,
        probeAt: new Date(),
        probeMs: Number.isFinite(r.ms) ? Math.round(r.ms) : null,
      })
      .where(and(eq(customers.remoteId, id), eq(customers.tenantId, tenantId)))
      .returning({ id: customers.id });
    n += res.length;
  }
  return n;
}
