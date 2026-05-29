import Link from "next/link";
import { db } from "@/lib/db";
import { customers, pendingUpdates, supportSessions, tenants, users } from "@/lib/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { discoverPeers } from "@/lib/peer-discovery";
import { DiscoveredPeerBanner } from "./_discovered";
import { RemoteButton } from "./_remote-button";
import { CustomerStatus } from "./_status";
import { CustomerPushButton, BulkPushButton } from "./_push-buttons";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const session = await auth();
  const currentUserId = session?.user.id;
  const tenant = (await db.select().from(tenants).where(eq(tenants.slug, "betaposlab")).limit(1))[0];
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
    })
    .from(customers)
    .leftJoin(users, eq(users.id, customers.assignedUserId))
    .where(eq(customers.tenantId, tenant.id))
    .orderBy(desc(customers.createdAt));

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

  const knownIds = new Set(rows.map((r) => r.remoteId).filter((x): x is string => !!x));
  const allPeers = await discoverPeers();
  const newPeers = allPeers.filter((p) => !knownIds.has(p.remoteId));

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
                    {c.remoteId && (
                      <CustomerPushButton
                        customerId={c.id}
                        customerName={c.name}
                        currentVersion={c.lastVersion}
                        pending={pendingByCustomer.get(c.id) ?? null}
                      />
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
