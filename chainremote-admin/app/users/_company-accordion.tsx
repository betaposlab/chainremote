"use client";

// "사용자" 탭 — super_admin(Chang) 의 회사별 아코디언.
// 회사가 위(굵게) + 아이디 N개. 회사 줄을 클릭하면 그 회사 사용자가 아래로 펼쳐지고
// 그 자리에서 추가/수정/비번리셋/삭제. 회사별 격리라 반복(베타포스랩×N) 없음.
// 액션: lib/actions/tenant-users.ts. 본인 계정 행은 읽기 전용(잠금 방지).

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  adminCreateUser,
  adminUpdateUser,
  adminResetUserPassword,
  adminDeleteUser,
} from "@/lib/actions/tenant-users";

type Role = "owner" | "admin" | "operator" | "viewer" | "super_admin";

export type AccUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
};

export type CompanyGroup = {
  id: string;
  displayName: string;
  slug: string;
  users: AccUser[];
};

const inp =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#00A0E5] focus:outline-none";

export function CompanyAccordion({
  companies,
  selfId,
}: {
  companies: CompanyGroup[];
  selfId: string;
}) {
  return (
    <div className="space-y-3">
      {companies.map((c) => (
        <Group key={c.id} company={c} selfId={selfId} />
      ))}
    </div>
  );
}

function Group({ company, selfId }: { company: CompanyGroup; selfId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-5 py-4">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-3 text-left"
        >
          <span className="w-4 text-slate-400">{open ? "▾" : "▸"}</span>
          <span className="font-semibold text-slate-900">
            {company.displayName}
          </span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            아이디 {company.users.length}개
          </span>
        </button>
        <Link
          href={`/admin/tenants/${company.id}/edit`}
          className="text-xs text-slate-400 hover:text-[#00A0E5]"
        >
          회사 정보 →
        </Link>
      </div>
      {open && (
        <div className="border-t border-slate-100 bg-slate-50/40 p-4">
          <AddForm tenantId={company.id} />
          <UserTable
            tenantId={company.id}
            users={company.users}
            selfId={selfId}
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
        <option value="owner">오너</option>
        <option value="admin">관리자</option>
        <option value="operator">직원</option>
        <option value="viewer">뷰어</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-[#00A0E5] px-3 py-2 text-sm font-medium text-white hover:bg-[#0086c2] disabled:opacity-50"
      >
        {pending ? "추가 중…" : "아이디 추가"}
      </button>
      {err && <p className="text-sm text-red-600 md:col-span-5">{err}</p>}
    </form>
  );
}

function UserTable({
  tenantId,
  users,
  selfId,
}: {
  tenantId: string;
  users: AccUser[];
  selfId: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">이름</th>
            <th className="px-3 py-2 font-medium">아이디</th>
            <th className="px-3 py-2 font-medium">역할</th>
            <th className="px-3 py-2 font-medium">활성</th>
            <th className="px-3 py-2 font-medium">최종 로그인</th>
            <th className="px-3 py-2 text-right font-medium">작업</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
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
}: {
  tenantId: string;
  user: AccUser;
  isSelf: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-3 py-2 font-medium">
          {user.displayName}
          {isSelf && (
            <span className="ml-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
              본인
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-slate-600">@{user.email}</td>
        <td className="px-3 py-2">{roleLabel(user.role)}</td>
        <td className="px-3 py-2">
          {user.isActive ? (
            <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
              활성
            </span>
          ) : (
            <span className="inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              비활성
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-slate-500">
          {user.lastLoginAt
            ? new Date(user.lastLoginAt).toLocaleString("ko-KR")
            : "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          {isSelf ? (
            <span className="text-xs text-slate-400">—</span>
          ) : (
            <>
              <button
                onClick={() => setEditing((v) => !v)}
                className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
              >
                {editing ? "닫기" : "수정"}
              </button>
              <button
                onClick={() => setResetting((v) => !v)}
                className="ml-1 px-2 py-1 text-xs text-slate-600 hover:text-[#00A0E5]"
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
                className="ml-1 px-2 py-1 text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                삭제
              </button>
            </>
          )}
        </td>
      </tr>
      {editing && (
        <tr className="bg-slate-50">
          <td colSpan={6} className="px-3 py-2">
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
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                placeholder="이름"
              />
              <select
                name="role"
                defaultValue={user.role === "super_admin" ? "owner" : user.role}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                <option value="owner">오너</option>
                <option value="admin">관리자</option>
                <option value="operator">직원</option>
                <option value="viewer">뷰어</option>
              </select>
              <label className="flex items-center gap-1 text-sm text-slate-600">
                <input type="checkbox" name="isActive" defaultChecked={user.isActive} />
                활성
              </label>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-[#00A0E5] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                저장
              </button>
            </form>
          </td>
        </tr>
      )}
      {resetting && (
        <tr className="bg-amber-50">
          <td colSpan={6} className="px-3 py-2">
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
              <span className="text-sm text-slate-700">
                {user.displayName} 의 새 비번:
              </span>
              <input
                name="newPassword"
                type="text"
                required
                minLength={4}
                placeholder="새 비번"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
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

function roleLabel(role: Role): string {
  switch (role) {
    case "owner":
      return "오너";
    case "admin":
      return "관리자";
    case "operator":
      return "직원";
    case "viewer":
      return "뷰어";
    case "super_admin":
      return "플랫폼 운영자";
  }
}
