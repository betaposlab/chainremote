import Link from "next/link";
import { db } from "@/lib/db";
import { customers, pendingUpdates, supportSessions, tenants, users } from "@/lib/schema";
import { eq, desc, asc, and, isNull, isNotNull, or } from "drizzle-orm";
import { listOrphanFavorites } from "@/lib/data/favorites";
import { listOpenAlerts, parseAlertDetail } from "@/lib/data/alerts";
import { AlertBanner } from "./_alert-banner";
import { formatRemoteId } from "@/lib/id-formatter";
import { DiscoveredPeerBanner } from "./_discovered";
import { RemoteButton } from "./_remote-button";
import { CustomerStatus, computeUpdateHealth } from "./_status";
import { CustomerPushButton, BulkPushButton } from "./_push-buttons";
import { ConfirmEnrollButton } from "./_enroll-confirm";
import { CustomerSearch } from "./_search";
import { DiskChip } from "./_disk-chip";
import { FirewallChip } from "./_firewall-chip";
import { AutoRefresh } from "./_auto-refresh";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canWrite } from "@/lib/roles";

export const dynamic = "force-dynamic";

// 정렬 가능 컬럼 화이트리스트 — 임의 컬럼 주입을 막는다. 값은 drizzle 컬럼.
const SORT_COLUMNS = {
  name: customers.name,
  assigned: users.displayName,
  contact: customers.contactName,
  phone: customers.phone,
  remoteId: customers.remoteId,
  status: customers.lastHeartbeatAt,
} as const;
type SortKey = keyof typeof SORT_COLUMNS;

// 클릭하면 활성 컬럼은 방향 토글, 나머지는 asc 로 시작. ▲/▼/↕ 표시.
function SortHeader({
  label,
  col,
  activeSort,
  activeDir,
}: {
  label: string;
  col: SortKey;
  activeSort: SortKey | null;
  activeDir: "asc" | "desc";
}) {
  const active = activeSort === col;
  const nextDir = active && activeDir === "asc" ? "desc" : "asc";
  return (
    <th className="text-left px-4 py-3 font-medium whitespace-nowrap">
      <Link
        href={`/customers?sort=${col}&dir=${nextDir}`}
        className="inline-flex items-center gap-1 hover:text-[#00A0E5]"
      >
        {label}
        <span className="text-[10px] text-slate-400">
          {active ? (activeDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
  );
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const currentUserId = session.user.id;
  const sp = await searchParams;
  const sortKey: SortKey | null =
    sp.sort && sp.sort in SORT_COLUMNS ? (sp.sort as SortKey) : null;
  const sortDir: "asc" | "desc" = sp.dir === "desc" ? "desc" : "asc";
  // 테넌트 격리: 로그인 사용자 회사로 한정.
  const tenant = (
    await db.select().from(tenants).where(eq(tenants.id, session.user.tenantId)).limit(1)
  )[0];
  if (!tenant) redirect("/login");
  // 미해결 설치 이벤트(기기 이동/동일상호 등) — 마스터 결정 큐.
  const openAlerts = await listOpenAlerts(tenant.id);
  // 담당 직원의 displayName 을 같이 끌어오기 위한 LEFT JOIN.
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      contactName: customers.contactName,
      phone: customers.phone,
      address: customers.address,
      remoteId: customers.remoteId,
      notes: customers.notes,
      assignedUserId: customers.assignedUserId,
      assignedUserName: users.displayName,
      lastHeartbeatAt: customers.lastHeartbeatAt,
      lastVersion: customers.lastVersion,
      arch: customers.arch,
      os: customers.os,
      osBits: customers.osBits,
      isInternal: customers.isInternal,
      pinOrder: customers.pinOrder,
      enrollStatus: customers.enrollStatus,
      diskTotalBytes: customers.diskTotalBytes,
      diskFreeBytes: customers.diskFreeBytes,
      tempBytes: customers.tempBytes,
      cleanupRequestedAt: customers.cleanupRequestedAt,
      cleanupResult: customers.cleanupResult,
      firewallControl: customers.firewallControl,
      firewallEnabled: customers.firewallEnabled,
      firewallDisarmCount: customers.firewallDisarmCount,
      firewallLastDisarmAt: customers.firewallLastDisarmAt,
    })
    .from(customers)
    .leftJoin(users, eq(users.id, customers.assignedUserId))
    .where(eq(customers.tenantId, tenant.id))
    // 기본은 내부 기기(pin_order) 상단 고정 + 등록순(최신 위). 헤더 클릭 시 그 컬럼 정렬, 등록순 tiebreak.
    .orderBy(
      ...(sortKey
        ? [
            sortDir === "desc" ? desc(SORT_COLUMNS[sortKey]) : asc(SORT_COLUMNS[sortKey]),
            desc(customers.createdAt),
          ]
        : [asc(customers.pinOrder), desc(customers.createdAt)]),
    );

  // 거래처별 대기 중 푸시 — 있으면 행에 표시.
  const pendingRows = await db
    .select({
      id: pendingUpdates.id,
      customerId: pendingUpdates.customerId,
      targetVersion: pendingUpdates.targetVersion,
      bulkBatchId: pendingUpdates.bulkBatchId,
      createdAt: pendingUpdates.createdAt,
    })
    .from(pendingUpdates)
    .where(
      and(
        eq(pendingUpdates.tenantId, tenant.id),
        isNull(pendingUpdates.appliedAt),
        isNull(pendingUpdates.cancelledAt),
        isNull(pendingUpdates.failedAt),
      ),
    );
  const pendingByCustomer = new Map(pendingRows.map((p) => [p.customerId, p]));

  // 거래처별 최근 "적용/실패" 푸시 — 자동업데이트 brick 감지용. applied 됐는데 heartbeat
  // 버전이 목표로 안 올라오거나 failed 면 _status 가 드러낸다.
  const updateRows = await db
    .select({
      customerId: pendingUpdates.customerId,
      targetVersion: pendingUpdates.targetVersion,
      appliedAt: pendingUpdates.appliedAt,
      failedAt: pendingUpdates.failedAt,
      failureReason: pendingUpdates.failureReason,
      createdAt: pendingUpdates.createdAt,
    })
    .from(pendingUpdates)
    .where(
      and(
        eq(pendingUpdates.tenantId, tenant.id),
        or(isNotNull(pendingUpdates.appliedAt), isNotNull(pendingUpdates.failedAt)),
      ),
    )
    .orderBy(desc(pendingUpdates.createdAt));
  // createdAt desc 로 정렬돼 있으니 거래처별 첫 행이 최신 결과.
  const updateByCustomer = new Map<
    string,
    { targetVersion: string; appliedAt: Date | null; failedAt: Date | null; failureReason: string | null }
  >();
  for (const u of updateRows) {
    if (u.customerId && !updateByCustomer.has(u.customerId)) {
      updateByCustomer.set(u.customerId, {
        targetVersion: u.targetVersion,
        appliedAt: u.appliedAt,
        failedAt: u.failedAt,
        failureReason: u.failureReason,
      });
    }
  }
  // brick/실패로 판정된 거래처 — 상단 경고 배너용.
  const updateProblems = rows.filter((c) => {
    const h = computeUpdateHealth(updateByCustomer.get(c.id), c.lastVersion);
    return h?.kind === "brick" || h?.kind === "failed";
  });

  const activeSessions = await db
    .select({
      id: supportSessions.id,
      customerId: supportSessions.customerId,
      startedAt: supportSessions.startedAt,
    })
    .from(supportSessions)
    .where(
      and(eq(supportSessions.tenantId, tenant.id), isNull(supportSessions.endedAt)),
    );
  const activeByCustomer = new Map(
    activeSessions
      .filter((s): s is { id: string; customerId: string; startedAt: Date } => !!s.customerId)
      .map((s) => [s.customerId, s]),
  );

  // "신규 거래처 후보" = 아직 customers 에 없는 orphan 즐겨찾기.
  // (옛 로컬 .toml 스캔은 패널이 NAS 컨테이너에서 돌면 항상 빈 배열이라 폐기했다.)
  const knownIds = new Set(rows.map((r) => r.remoteId).filter((x): x is string => !!x));
  const orphanFavorites = await listOrphanFavorites(tenant.id);
  const newPeers = orphanFavorites.filter((p) => !knownIds.has(p.remoteId));
  // auto-enroll 후보 — agent 가 스스로 등록한 미확정(pending) 거래처.
  const pendingEnroll = rows.filter((c) => c.enrollStatus === "pending");

  return (
    <div className="px-8 py-6 max-w-7xl">
      <AutoRefresh />
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">거래처</h1>
          <p className="text-sm text-slate-500 mt-1">
            등록된 거래처 {rows.length}곳 · ID 등록된 곳은 클릭 한 번으로 원격 접속
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CustomerSearch />
          <BulkPushButton />
          <Link
            href="/customers/new"
            className="rounded-lg bg-[#00A0E5] hover:bg-[#0090d0] text-white px-4 py-2 text-sm font-medium whitespace-nowrap"
          >
            + 거래처 추가
          </Link>
        </div>
      </header>

      <DiscoveredPeerBanner peers={newPeers} />

      {pendingEnroll.length > 0 && (
        <div className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ⊕ <span className="font-semibold">{pendingEnroll.length}곳</span>이 자동등록(에이전트 설치)으로
          후보 등록됐습니다. 표에서 <span className="font-medium">후보·자동등록</span> 거래처를
          확인(✓)하면 정식 거래처로 등록됩니다 (업데이트는 확인 안 해도 자동 적용됩니다).
        </div>
      )}

      <AlertBanner
        items={openAlerts.map(({ alert, customerName }) => ({
          id: alert.id,
          type: alert.type,
          customerName,
          detail: parseAlertDetail(alert.detail),
        }))}
        isOwner={canWrite(session.user.role)}
      />

      {updateProblems.length > 0 && (
        <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          ⚠ <span className="font-semibold">{updateProblems.length}곳</span>에서 자동업데이트가
          “적용됨”으로 보고됐지만 새 버전 heartbeat가 확인되지 않았습니다 (설치 실패·brick 의심).
          아래 표에서 <span className="font-medium text-rose-700">⚠ 업뎃 미확인</span> /
          <span className="font-medium text-rose-700"> 업뎃 실패</span> 표시된 거래처를 점검하세요
          (RDP·현장).
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <SortHeader label="상호" col="name" activeSort={sortKey} activeDir={sortDir} />
              <SortHeader label="직원" col="assigned" activeSort={sortKey} activeDir={sortDir} />
              <SortHeader label="거래처 담당자" col="contact" activeSort={sortKey} activeDir={sortDir} />
              <SortHeader label="연락처" col="phone" activeSort={sortKey} activeDir={sortDir} />
              <SortHeader label="원격 ID" col="remoteId" activeSort={sortKey} activeDir={sortDir} />
              <SortHeader label="상태" col="status" activeSort={sortKey} activeDir={sortDir} />
              <th className="text-left px-4 py-3 font-medium">메모</th>
              <th className="text-right px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => {
              const active = activeByCustomer.get(c.id) ?? null;
              // OS 배지(마이그 021): os 있으면 "Win7 · 64비트", 없으면 arch 폴백(구버전 에이전트).
              //   비트수는 OS 네이티브(osBits) 우선, 없으면 페이로드 arch. Win7 은 호박색으로 강조.
              const osBits =
                c.osBits === "x64" || c.arch === "x64"
                  ? "64비트"
                  : c.osBits === "x86" || c.arch === "x86"
                    ? "32비트"
                    : "";
              const osShort = c.os
                ? c.os.includes("Windows 11")
                  ? "Win11"
                  : c.os.includes("Windows 10")
                    ? "Win10"
                    : c.os.includes("Windows 8.1")
                      ? "Win8.1"
                      : c.os.includes("Windows 8")
                        ? "Win8"
                        : c.os.includes("Windows 7")
                          ? "Win7"
                          : c.os.replace("Windows ", "Win")
                : "";
              const osBadgeText = osShort
                ? osBits
                  ? `${osShort} · ${osBits}`
                  : osShort
                : osBits;
              const osIsWin7 = c.os?.includes("Windows 7") ?? false;
              const searchHay = [
                c.name,
                c.assignedUserName,
                c.contactName,
                c.phone,
                c.remoteId,
                c.notes,
                // OS/arch 검색: "Win7"/"32비트"/"x86" 등으로 fleet 을 갈라 볼 수 있게.
                osBadgeText,
                c.os ?? "",
                c.arch === "x86" ? "x86" : c.arch === "x64" ? "x64" : "",
              ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              return (
                <tr
                  key={c.id}
                  data-search={searchHay}
                  className="hover:bg-slate-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/customers/${c.id}/edit`}
                      className="font-medium hover:text-[#00A0E5]"
                    >
                      {c.name}
                    </Link>
                    {c.enrollStatus === "pending" && (
                      <span className="ml-2 inline-block bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px] font-medium align-middle">
                        후보·자동등록
                      </span>
                    )}
                    {c.address && (
                      <div className="text-xs text-slate-400 mt-0.5">{c.address}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.assignedUserName ? (
                      <span
                        className={
                          c.assignedUserId === currentUserId
                            ? "inline-block bg-[#00A0E5]/10 text-[#0070a8] px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap"
                            : "text-slate-600 whitespace-nowrap"
                        }
                      >
                        {c.assignedUserName}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">미배정</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{c.contactName ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums whitespace-nowrap">{c.phone ?? "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {c.remoteId ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="inline-block bg-[#00A0E5]/10 text-[#0070a8] px-2 py-0.5 rounded whitespace-nowrap">
                          {formatRemoteId(c.remoteId)}
                        </span>
                        {/* OS 배지(마이그 021) — "Win7 · 64비트" 식으로 OS+네이티브 비트수. Win7 은
                            호박색 강조. os 미보고(구버전)면 arch 로 32/64비트만 폴백. 내부기기 제외. */}
                        {!c.isInternal && osBadgeText && (
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ${
                              osIsWin7
                                ? "bg-amber-100 text-amber-700 font-medium"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {osBadgeText}
                          </span>
                        )}
                        {/* 디스크 관제(마이그 024) — 여유공간 경고 + 원격 정리 버튼. */}
                        <DiskChip
                          remoteId={c.remoteId}
                          totalBytes={c.diskTotalBytes}
                          freeBytes={c.diskFreeBytes}
                          tempBytes={c.tempBytes}
                          cleanupRequestedAt={
                            c.cleanupRequestedAt
                              ? c.cleanupRequestedAt.toISOString()
                              : null
                          }
                          cleanupResult={c.cleanupResult}
                        />
                        {/* 방화벽 관제(마이그 028) — 자동 해제 대상일 때만 상태+누적 표시. */}
                        <FirewallChip
                          control={c.firewallControl}
                          enabled={c.firewallEnabled}
                          disarmCount={c.firewallDisarmCount}
                          lastDisarmAt={
                            c.firewallLastDisarmAt
                              ? c.firewallLastDisarmAt.toISOString()
                              : null
                          }
                        />
                      </div>
                    ) : (
                      <span className="text-slate-400">미등록</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <CustomerStatus
                      lastHeartbeatAt={c.lastHeartbeatAt}
                      lastVersion={c.lastVersion}
                      update={updateByCustomer.get(c.id) ?? null}
                      isInternal={c.isInternal}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-[16ch] truncate">
                    {c.notes ?? ""}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {c.remoteId ? (
                      <RemoteButton
                        customerName={c.name}
                        remoteId={c.remoteId}
                        lastHeartbeatAt={c.lastHeartbeatAt}
                        activeSessionId={active?.id ?? null}
                        activeStartedAt={active?.startedAt ?? null}
                      />
                    ) : (
                      <Link
                        href={`/customers/${c.id}/edit`}
                        className="inline-flex items-center text-xs text-slate-400 hover:text-[#00A0E5] px-3 py-1.5"
                      >
                        ID 등록
                      </Link>
                    )}
                    {c.remoteId && !c.isInternal && c.enrollStatus === "active" && (
                      <CustomerPushButton
                        customerId={c.id}
                        customerName={c.name}
                        currentVersion={c.lastVersion}
                        pending={pendingByCustomer.get(c.id) ?? null}
                      />
                    )}
                    {c.enrollStatus === "pending" && (
                      <ConfirmEnrollButton customerId={c.id} customerName={c.name} />
                    )}
                    <Link
                      href={`/customers/${c.id}/edit`}
                      className="inline-flex items-center text-xs text-slate-500 hover:text-slate-900 px-2 py-1.5 ml-1"
                    >
                      수정
                    </Link>
                  </td>
                </tr>
              );
            })}
            <tr id="cust-search-empty" style={{ display: "none" }}>
              <td colSpan={8} className="px-4 py-12 text-center text-slate-400 text-sm">
                검색 결과가 없습니다.
              </td>
            </tr>
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-4 py-12 text-center text-slate-400 text-sm">
            아직 등록된 거래처가 없습니다.
            <Link href="/customers/new" className="text-[#00A0E5] hover:underline ml-2">
              첫 거래처 추가하기
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
