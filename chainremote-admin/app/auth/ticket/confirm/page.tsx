// 계정 전환 확인 — 브라우저에 다른 계정이 로그인돼 있는데 본사 앱이 [관리 패널] 을 열었을 때.
//
// ★왜 묻는가: 브라우저 쿠키는 도메인당 하나뿐이라 앞 계정 세션이 교체된다. 대리점에서
//   관리자와 직원은 보이는 화면이 다르고(계정 관리), 무엇보다 **그 뒤의 모든 작업이 바뀐
//   계정으로 감사로그에 남는다.** 조용히 바뀌면 나중에 "누가 지웠냐"가 엉뚱한 사람을 가리킨다.
//   같은 계정이면 이 화면은 아예 안 뜬다(/auth/ticket 이 바로 통과시킨다).

import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { auth, signIn } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { peekPanelTicket } from "@/lib/panel-ticket";
import { roleLabel } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ConfirmSwitchPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const t = (await searchParams).t ?? "";
  const target = await peekPanelTicket(t);
  if (!target) redirect("/login"); // 만료·재사용·위조 — 아무것도 알려 주지 않는다.

  const current = (await auth())?.user?.id;
  // 로그아웃됐거나 같은 계정이면 물어볼 것이 없다 — 원래 경로가 알아서 처리한다.
  if (!current || current === target) {
    redirect(`/auth/ticket?t=${encodeURIComponent(t)}`);
  }

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
    })
    .from(users)
    .where(inArray(users.id, [current, target]));
  const who = (id: string) => rows.find((r) => r.id === id);
  const from = who(current);
  const to = who(target);

  async function switchAccount(formData: FormData) {
    "use server";
    const ticket = String(formData.get("t") ?? "");
    // 여기서 처음이자 마지막으로 소비된다. 실패하면 provider 가 null 을 돌려 로그인 화면으로.
    await signIn("panel-ticket", { ticket, redirectTo: "/" });
  }

  const Card = ({
    label,
    person,
  }: {
    label: string;
    person?: { email: string; displayName: string; role: string };
  }) => (
    <div className="rounded-lg border border-[#566999] bg-[#36456e] p-3">
      <div className="text-xs text-[#b9bfd2]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[#eef1f7]">
        {person?.displayName ?? "알 수 없는 계정"}
      </div>
      <div className="mt-0.5 text-xs text-[#cbd1e0]">
        @{person?.email ?? "—"} · {person ? roleLabel(person.role) : "—"}
      </div>
    </div>
  );

  return (
    <div className="aurora-bg flex min-h-screen w-full flex-col items-center justify-center bg-[#2b364f] px-4">
      <div className="relative z-10 w-full max-w-md space-y-5 rounded-xl border border-[#566999] bg-[#3d4e7a] p-7 shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            다른 계정으로 바꿀까요?
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[#cbd1e0]">
            본사 앱이 관리 패널을 열었습니다. 브라우저는 계정을 하나만 유지할 수 있어,
            바꾸면 지금 로그인은 끊깁니다.
          </p>
        </div>

        <div className="space-y-2">
          <Card label="지금 로그인" person={from} />
          <Card label="본사 앱 계정" person={to} />
        </div>

        <p className="text-xs leading-relaxed text-[#b9bfd2]">
          바꾼 뒤의 작업은 모두 <b className="text-[#eef1f7]">{to?.displayName}</b> 이름으로
          기록에 남습니다.
        </p>

        <div className="flex gap-2">
          <a href="/" className="btn btn-ghost flex-1 text-center">
            그대로 두기
          </a>
          <form action={switchAccount} className="flex-1">
            <input type="hidden" name="t" value={t} />
            <button type="submit" className="btn btn-primary w-full">
              계정 바꾸기
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
