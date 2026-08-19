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
      <tr >
        <td className="px-4 py-3 font-medium">
          {user.displayName}
          {isSelf && (
            <span className="ml-2 inline-block rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-[#b9bfd2]">
              본인
            </span>
          )}
          {/* 좁은 화면에서는 아이디·활성 열을 접으므로 여기 요약한다. 이름은 겹칠 수 있어
              계정을 가르는 건 결국 아이디다. 비활성 계정은 그 사실이 더 중요하니 같이 붙인다. */}
          <div className="mt-0.5 text-xs text-[#b9bfd2] md:hidden">
            @{user.email}
            {!user.isActive && <span className="ml-1 text-[#ff6b6f]">· 비활성</span>}
          </div>
        </td>
        <td className="px-4 py-3 text-[#cbd1e0] hidden md:table-cell">@{user.email}</td>
        <td className="px-4 py-3">{roleLabel(user.role)}</td>
        <td className="px-4 py-3 hidden md:table-cell">
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
        <td className="px-4 py-3 text-xs text-[#b9bfd2] hidden md:table-cell">
          {user.lastLoginAt
            ? new Date(user.lastLoginAt).toLocaleString("ko-KR")
            : "—"}
        </td>
        <td className="px-4 py-3 text-xs hidden md:table-cell">
          <HqStatus
            lastVersion={user.lastVersion}
            lastHeartbeatAt={user.lastHeartbeatAt}
            targetVersion={targetVersion}
          />
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <button
            onClick={() => setEditing((v) => !v)}
            className="px-2 py-1 text-xs text-[#cbd1e0] hover:text-white"
          >
            {editing ? "닫기" : "수정"}
          </button>
          <button
            onClick={() => setResetting((v) => !v)}
            className="ml-1 px-2 py-1 text-xs text-[#cbd1e0] hover:text-[#c3d3ff]"
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
              className="ml-1 px-2 py-1 text-xs text-[#ff9a9e] hover:text-[#ffcdd0] disabled:opacity-50"
            >
              삭제
            </button>
          )}
        </td>
      </tr>
      {editing && (
        <tr className="bg-white/[0.02]">
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
                className="rounded-md border border-[#7485ae] px-3 py-1.5 text-sm"
                placeholder="이름"
              />
              {/* 본인 행에선 역할·활성을 컨트롤로 내보내지 않는다. 이유가 둘이다.
                  ① 자기잠금 — disabled 컨트롤은 FormData 에 안 실려서, 이름만 고쳐 저장해도
                     서버 기본값(직원)으로 강등 + 비활성화되는 사고가 났다(서버도 본인 행은
                     이름만 반영한다).
                  ② 종전엔 disabled 를 걸고 이유는 title 툴팁에만 뒀는데, 이 select 엔 비활성
                     스타일이 없어 **멀쩡한 드롭다운이 안 눌리는 것처럼** 보였다. 못 쓰는
                     컨트롤을 그려 두는 대신 현재 값을 글자로 보여주고 이유를 눈에 보이게 적는다. */}
              {isSelf ? (
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm text-[#cbd1e0]">
                  {roleLabel(user.role)} · {user.isActive ? "활성" : "비활성"}
                </span>
              ) : (
                <>
                  <select
                    name="role"
                    defaultValue={user.role}
                    className="rounded-md border border-[#7485ae] px-3 py-1.5 text-sm"
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
                  <label className="flex items-center gap-1 text-sm text-[#cbd1e0]">
                    <input
                      type="checkbox"
                      name="isActive"
                      defaultChecked={user.isActive}
                    />
                    활성
                  </label>
                </>
              )}
              <button
                type="submit"
                disabled={pending}
                className="btn btn-primary"
              >
                저장
              </button>
              {isSelf && (
                <p className="basis-full text-xs text-[#b9bfd2]">
                  본인 계정은 이름만 바꿀 수 있습니다. 스스로 권한을 내리거나 끄면 다시
                  들어올 수 없어 막아 뒀습니다.
                </p>
              )}
            </form>
          </td>
        </tr>
      )}
      {resetting && (
        <tr className="bg-amber-500/[0.06]">
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
              <span className="text-sm text-[#eef1f7]">
                {user.displayName} 의 새 비번:
              </span>
              <input
                name="newPassword"
                type="text"
                required
                minLength={4}
                placeholder="새 비번"
                className="rounded-md border border-[#7485ae] px-3 py-1.5 text-sm"
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

