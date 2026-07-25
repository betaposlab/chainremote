"use client";

import { useState, useTransition } from "react";
import { resetPassword, updateUser, deleteUser } from "@/lib/actions/users";
import { HqStatus } from "../customers/_status";
import { roleLabel, ASSIGNABLE_ROLES, type Role } from "@/lib/roles";

type Props = {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: Role;
    isActive: boolean;
    lastLoginAt: string | null;
    lastVersion: string | null;
    lastHeartbeatAt: string | null;
  };
  targetVersion: string | null;
  isSelf: boolean;
};

export function UserRow({ user, isSelf, targetVersion }: Props) {
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <tr className="hover:bg-slate-50 transition-colors">
        <td className="px-4 py-3 font-medium">
          {user.displayName}
          {isSelf && (
            <span className="ml-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
              본인
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-slate-600">@{user.email}</td>
        <td className="px-4 py-3">{roleLabel(user.role)}</td>
        <td className="px-4 py-3">
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
        <td className="px-4 py-3 text-xs text-slate-500">
          {user.lastLoginAt
            ? new Date(user.lastLoginAt).toLocaleString("ko-KR")
            : "—"}
        </td>
        <td className="px-4 py-3 text-xs">
          <HqStatus
            lastVersion={user.lastVersion}
            lastHeartbeatAt={user.lastHeartbeatAt}
            targetVersion={targetVersion}
          />
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
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
          {!isSelf && (
            <button
              onClick={() =>
                confirm(`${user.displayName} 사용자를 삭제할까요?`) &&
                startTransition(async () => {
                  await deleteUser(user.id);
                })
              }
              disabled={pending}
              className="ml-1 px-2 py-1 text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
            >
              삭제
            </button>
          )}
        </td>
      </tr>
      {editing && (
        <tr className="bg-slate-50">
          <td colSpan={7} className="px-4 py-3">
            <form
              action={(fd) =>
                startTransition(async () => {
                  await updateUser(user.id, fd);
                  setEditing(false);
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
              {/* 본인 행에선 역할·활성을 아예 안 보낸다. disabled 컨트롤은 FormData 에 실리지
                  않아, 이름만 고쳐 저장해도 서버 기본값(직원)으로 강등 + 비활성화되는
                  자기잠금 사고가 났다. 서버(updateUser)도 본인 행은 이름만 반영한다. */}
              <select
                name="role"
                defaultValue={user.role}
                disabled={isSelf}
                title={isSelf ? "본인 역할은 변경 불가" : ""}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
                {user.role === "viewer" && (
                  <option value="viewer">{roleLabel("viewer")}</option>
                )}
              </select>
              <label className="flex items-center gap-1 text-sm text-slate-600">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={user.isActive}
                  disabled={isSelf}
                />
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
          <td colSpan={7} className="px-4 py-3">
            <form
              action={(fd) =>
                startTransition(async () => {
                  await resetPassword(user.id, fd);
                  setResetting(false);
                  alert(`${user.displayName} 비번이 리셋됐어요.`);
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

