import Link from "next/link";
import { db } from "@/lib/db";
import { customers, pendingUpdates, supportSessions, tenants, users } from "@/lib/schema";
import { eq, desc, asc, and, isNull, isNotNull, or } from "drizzle-orm";
import { listOrphanFavorites } from "@/lib/data/favorites";
import { DiscoveredPeerBanner } from "./_discovered";
import { RemoteButton } from "./_remote-button";
import { CustomerStatus, computeUpdateHealth } from "./_status";
import { CustomerPushButton, BulkPushButton } from "./_push-buttons";
import { ConfirmEnrollButton } from "./_enroll-confirm";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const currentUserId = session.user.id;
  // ★ 테넌트 격리: 로그인 사용자 회사로 한정 (하드코딩 betaposlab 제거).
  const tenant = (
    await db.select().from(tenants).where(eq(tenants.id, session.user.tenantId)).limit(1)
  )[0];
  if (!tenant) redirect("/login");
  // 담당 직원 (assignedUser) 의 displayName 을 같이 가져오기 위한 LEFT JOIN
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
      isInternal: customers.isInternal,
      pinOrder: customers.pinOrder,
      enrollStatus: customers.enrollStatus,
    })
    .from(customers)
    .leftJoin(users, eq(users.id, customers.assignedUserId))
    .where(eq(customers.tenantId, tenant.id))
    // 내부 기기(pin_order 1..N) 를 상단 고정, 그 아래 일반 거래처는 등록순(최신 위).
    .orderBy(asc(customers.pinOrder), desc(customers.createdAt));

  // 거래처별 대기 중 푸시 (있으면 행에 표시).
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

  // 거래처별 최근 "적용/실패" 푸시 — 자동업데이트 brick 감지용.
  // applied 됐는데 heartbeat 버전이 목표로 안 올라가면(또는 failed) _status 가 드러냄.
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
  // 거래처별 최신 1건만 (createdAt desc 라 first = 최신 결과).
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
  // brick/실패로 판정되는 거래처 (상단 경고 배너용).
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

  // "신규 거래처 후보" — DB 의 orphan 즐겨찾기(아직 customers 에 등록 안 된 ID).
  // (구: 로컬 .toml 스캔 → 패널이 NAS 컨테이너에서 돌면 항상 빈 배열이라 폐기)
  const knownIds = new Set(rows.map((r) => r.remoteId).filter((x): x is string => !!x));
  const orphanFavorites = await listOrphanFavorites(tenant.id);
  const newPeers = orphanFavorites.filter((p) => !knownIds.has(p.remoteId));
  // 자가등록(⑤ auto-enroll) 후보 — agent 가 스스로 등록한 미확정(pending) 거래처.
  const pendingEnroll = rows.filter((c) => c.enrollStatus === "pending");

  return (
    <div className="px-8 py-6 max-w-6xl">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">거래처</h1>
          <p className="text-sm text-slate-500 mt-1">
            등록된 거래처 {rows.length}곳 · ID 등록된 곳은 클릭 한 번으로 원격 접속
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BulkPushButton />
          <Link
            href="/customers/new"
            className="rounded-lg bg-[#00A0E5] hover:bg-[#0090d0] text-white px-4 py-2 text-sm font-medium"
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

      {updateProblems.length > 0 && (
        <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          ⚠ <span className="font-semibold">{updateProblems.length}곳</span>에서 자동업데이트가
          “적용됨”으로 보고됐지만 새 버전 heartbeat가 확인되지 않았습니다 (설치 실패·brick 의심).
          아래 표에서 <span className="font-medium text-rose-700">⚠ 업뎃 미확인</span> /
          <span className="font-medium text-rose-700"> 업뎃 실패</span> 표시된 거래처를 점검하세요
          (RDP·현장).
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">상호</th>
              <th className="text-left px-4 py-3 font-medium">직원</th>
              <th className="text-left px-4 py-3 font-medium">거래처 담당자</th>
              <th className="text-left px-4 py-3 font-medium">연락처</th>
              <th className="text-left px-4 py-3 font-medium">원격 ID</th>
              <th className="text-left px-4 py-3 font-medium">상태</th>
              <th className="text-left px-4 py-3 font-medium">메모</th>
              <th className="text-right px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => {
              const active = activeByCustomer.get(c.id) ?? null;
              return (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
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
                            ? "inline-block bg-[#00A0E5]/10 text-[#0070a8] px-2 py-0.5 rounded text-xs font-medium"
                            : "text-slate-600"
                        }
                      >
                        {c.assignedUserName}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">미배정</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.contactName ?? "-"}</td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums">{c.phone ?? "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {c.remoteId ? (
                      <span className="inline-block bg-[#00A0E5]/10 text-[#0070a8] px-2 py-0.5 rounded">
                        {c.remoteId}
                      </span>
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
                        customerId={c.id}
                        remoteId={c.remoteId}
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
