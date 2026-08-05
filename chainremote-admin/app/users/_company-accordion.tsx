"use client";

// "사용자" 탭의 super_admin(Chang) 회사별 아코디언. 회사 줄을 클릭하면 그 회사 사용자가
// 펼쳐지고 그 자리에서 추가/수정/비번리셋/삭제. 회사별로 묶여 있어 목록이 반복되지 않는다.
// 액션은 lib/actions/tenant-users.ts. 본인 계정 행은 self-lockout 방지로 읽기 전용.

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  adminCreateUser,
  adminUpdateUser,
  adminResetUserPassword,
  adminDeleteUser,
} from "@/lib/actions/tenant-users";
import { HqStatus } from "../customers/_status";
import { roleLabel, ASSIGNABLE_ROLES, type Role } from "@/lib/roles";


export type AccUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  lastVersion: string | null;
  lastHeartbeatAt: string | null;
};

export type CompanyGroup = {
  id: string;
  displayName: string;
  slug: string;
  users: AccUser[];
};

const inp =
  "rounded-md border border-[#98a4c3] px-3 py-2 text-sm focus:border-[#4c7dff] focus:outline-none";

export function CompanyAccordion({
  companies,
  selfId,
  targetVersion,
}: {
  companies: CompanyGroup[];
  selfId: string;
  targetVersion: string | null;
}) {
  return (
    <div className="space-y-3">
      {companies.map((c) => (
        <Group key={c.id} company={c} selfId={selfId} targetVersion={targetVersion} />
      ))}
    </div>
  );
}

function Group({
  company,
  selfId,
  targetVersion,
}: {
  company: CompanyGroup;
  selfId: string;
  targetVersion: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-[#7687b2] bg-[#4e639c]">
      <div className="flex items-center justify-between px-5 py-4">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-3 text-left"
        >
          <span className="w-4 text-[#e4e7f0]">{open ? "▾" : "▸"}</span>
          <span className="font-semibold text-white">
            {company.displayName}
          </span>
          <span className="rounded bg-white/[0.06] px-2 py-0.5 text-xs text-[#dfe3ee]">
            아이디 {company.users.length}개
          </span>
        </button>
        <Link
          href={`/admin/tenants/${company.id}/edit`}
          className="text-xs text-[#e4e7f0] hover:text-[#e0e8ff]"
        >
          회사 정보 →
        </Link>
      </div>
      {open && (
        <div className="border-t border-[#6d7fac] bg-white/[0.02] p-4">
          <AddForm tenantId={company.id} />
          <UserTable
            tenantId={company.id}
            users={company.users}
            selfId={selfId}
            targetVersion={targetVersion}
          />
        </div>
      )}
    </div>
  );
}

function AddForm({ tenantId }: { tenantId: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function handle(fd: FormData) {
    setErr(null);
    setPending(true);
    try {
      await adminCreateUser(tenantId, fd);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "추가 실패");
    } finally {
      setPending(false);
    }
  }
  return (
    <form action={handle} className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-5">
      <input name="email" required placeholder="아이디 (예: jihee)" className={inp} />
      <input name="displayName" required placeholder="이름" className={inp} />
      <input name="password" required placeholder="초기 비번 (4자+)" className={inp} />
      <select name="role" defaultValue="operator" className={inp}>
        {ASSIGNABLE_ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary"
      >
        {pending ? "추가 중…" : "아이디 추가"}
      </button>
      {err && <p className="text-sm text-[#ff9a9e] md:col-span-5">{err}</p>}
    </form>
  );
}

function UserTable({
  tenantId,
  users,
  selfId,
  targetVersion,
}: {
  tenantId: string;
  users: AccUser[];
  selfId: string;
  targetVersion: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-[#7687b2] bg-[#4e639c]">
      <table className="panel-table">
        <thead className="bg-white/[0.025] text-left text-xs text-[#b9bfd2]">
          <tr>
            <th className="px-3 py-2 font-medium">이름</th>
            <th className="px-3 py-2 font-medium">아이디</th>
            <th className="px-3 py-2 font-medium">역할</th>
            <th className="px-3 py-2 font-medium">활성</th>
            <th className="px-3 py-2 font-medium">최종 로그인</th>
            <th className="px-3 py-2 font-medium">HQ 상태</th>
            <th className="px-3 py-2 text-right font-medium">작업</th>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-4 text-center text-[#e4e7f0]">
                아이디 없음 — 위에서 추가하세요.
              </td>
            </tr>
          )}
          {users.map((u) => (
            <Row
              key={u.id}
              tenantId={tenantId}
              user={u}
              isSelf={u.id === selfId}
              targetVersion={targetVersion}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  tenantId,
  user,
  isSelf,
  targetVersion,
}: {
  tenantId: string;
  user: AccUser;
  isSelf: boolean;
  targetVersion: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <tr className="hover:bg-white/[0.04]">
        <td className="px-3 py-2 font-medium">
          {user.displayName}
          {isSelf && (
            <span className="ml-2 inline-block rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-[#b9bfd2]">
              본인
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-[#dfe3ee]">@{user.email}</td>
        <td className="px-3 py-2">{roleLabel(user.role)}</td>
        <td className="px-3 py-2">
          {user.isActive ? (
            <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
              활성
            </span>
          ) : (
            <span className="inline-block rounded bg-white/[0.06] px-2 py-0.5 text-xs text-[#b9bfd2]">
              비활성
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-[#b9bfd2]">
          {user.lastLoginAt
            ? new Date(user.lastLoginAt).toLocaleString("ko-KR")
            : "—"}
        </td>
        <td className="px-3 py-2 text-xs">
          <HqStatus
            lastVersion={user.lastVersion}
            lastHeartbeatAt={user.lastHeartbeatAt}
            targetVersion={targetVersion}
          />
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          {isSelf ? (
            <span className="text-xs text-[#e4e7f0]">—</span>
          ) : (
            <>
              <button
                onClick={() => setEditing((v) => !v)}
                className="px-2 py-1 text-xs text-[#dfe3ee] hover:text-white"
              >
                {editing ? "닫기" : "수정"}
              </button>
              <button
                onClick={() => setResetting((v) => !v)}
                className="ml-1 px-2 py-1 text-xs text-[#dfe3ee] hover:text-[#e0e8ff]"
              >
                비번 리셋
              </button>
              <button
                onClick={() =>
                  confirm(`${user.displayName} (@${user.email}) 아이디를 삭제할까요?`) &&
                  startTransition(async () => {
                    try {
                      await adminDeleteUser(tenantId, user.id);
                    } catch (e) {
                      alert(e instanceof Error ? e.message : "삭제 실패");
                    }
                  })
                }
                disabled={pending}
                className="ml-1 px-2 py-1 text-xs text-[#ff9a9e] hover:text-[#ffcdd0] disabled:opacity-50"
              >
                삭제
              </button>
            </>
          )}
        </td>
      </tr>
      {editing && (
        <tr className="bg-white/[0.02]">
          <td colSpan={7} className="px-3 py-2">
            <form
              action={(fd) =>
                startTransition(async () => {
                  try {
                    await adminUpdateUser(tenantId, user.id, fd);
                    setEditing(false);
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "저장 실패");
                  }
                })
              }
              className="flex flex-wrap items-center gap-2"
            >
              <input
                name="displayName"
                defaultValue={user.displayName}
                className="rounded-md border border-[#98a4c3] px-3 py-1.5 text-sm"
                placeholder="이름"
              />
              <select
                name="role"
                defaultValue={user.role === "super_admin" ? "owner" : user.role}
                className="rounded-md border border-[#98a4c3] px-3 py-1.5 text-sm"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-sm text-[#dfe3ee]">
                <input type="checkbox" name="isActive" defaultChecked={user.isActive} />
                활성
              </label>
              <button
                type="submit"
                disabled={pending}
                className="btn btn-primary"
              >
                저장
              </button>
            </form>
          </td>
        </tr>
      )}
      {resetting && (
        <tr className="bg-amber-500/[0.06]">
          <td colSpan={7} className="px-3 py-2">
            <form
              action={(fd) =>
                startTransition(async () => {
                  try {
                    await adminResetUserPassword(tenantId, user.id, fd);
                    setResetting(false);
                    alert(`${user.displayName} 비번이 리셋됐어요.`);
                  } catch (e) {
                    alert(e instanceof Error ? e.message : "리셋 실패");
                  }
                })
              }
              className="flex items-center gap-2"
            >
              <span className="text-sm text-[#f7f8fa]">
                {user.displayName} 의 새 비번:
              </span>
              <input
                name="newPassword"
                type="text"
                required
                minLength={4}
                placeholder="새 비번"
                className="rounded-md border border-[#98a4c3] px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                리셋
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

