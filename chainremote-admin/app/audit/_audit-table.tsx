import type { AuditRow } from "@/lib/data/audit-search";

// 행위 이름 — 코드가 아니라 사람 말로 보여 준다. 여기 없는 코드는 코드 그대로 나오므로
//   새 감사 항목을 추가하고 이 표를 안 고쳐도 화면이 깨지지는 않는다(줄이 안 보이는 것보다 낫다).
const LABEL: Record<string, string> = {
  "auth.login": "로그인",
  "auth.login_failed": "로그인 실패",
  "auth.takeover": "다른 기기 접속 인계",
  "customer.delete": "거래처 삭제",
  "tenant.delete": "회사 삭제",
  "user.create": "직원 추가",
  "user.delete": "직원 삭제",
  "user.role_change": "권한 변경",
  "user.password_reset": "비밀번호 재설정",
  "tenant.owner_password_reset": "대리점 관리자 비번 재설정",
  "session.unknown_peer": "목록에 없는 ID 로 원격",
  "push.bulk": "일괄 푸시",
  "tenant.unattended_change": "무인접속 설정 변경",
  "customer.unattended_password_set": "무인접속 비밀번호 설정",
  "customer.unattended_password_clear": "무인접속 비밀번호 삭제",
  "feedback.update": "문의 처리",
  "feedback.delete": "문의 삭제",
};

const FAIL_REASON: Record<string, string> = {
  no_such_user: "없는 아이디",
  bad_password: "비밀번호 불일치",
  tenant_blocked: "정지된 회사",
};

const VIA: Record<string, string> = {
  browser: "관리 화면",
  hq: "본사 앱",
  takeover: "본사 앱(인계)",
};

/** 한 줄이 무슨 일이었는지 — 행위마다 볼 만한 값이 다르다. */
function detail(r: AuditRow): string {
  const m = (r.metadata ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof m.via === "string") parts.push(VIA[m.via] ?? m.via);
  if (typeof m.reason === "string")
    parts.push(FAIL_REASON[m.reason] ?? m.reason);
  if (typeof m.attemptedId === "string" && !r.actorEmail)
    parts.push(`시도한 아이디: ${m.attemptedId}`);
  if (typeof m.device === "string" && m.device) parts.push(m.device);
  // 로그인 계열이 아닌 행위는 대상 이름이 제일 궁금하다.
  for (const k of ["remoteId", "tenantName", "targetEmail", "name", "customerName", "email", "title", "displayName"]) {
    if (typeof m[k] === "string" && m[k]) parts.push(String(m[k]));
  }
  return parts.join(" · ");
}

// inet 은 텍스트로 꺼내면 마스크가 붙는다 — 112.186.209.131/32. 화면엔 주소만 보인다.
function ip(v: string | null): string {
  if (!v) return "—";
  return v.replace(/\/(?:32|128)$/, "");
}

function when(d: Date): string {
  const s = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(s.getMonth() + 1)}-${p(s.getDate())} ${p(s.getHours())}:${p(s.getMinutes())}`;
}

export function AuditTable({
  rows,
  showTenant,
}: {
  rows: AuditRow[];
  showTenant: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[#566999] bg-[#3d4e7a] px-5 py-10 text-center text-sm text-[#ccd2e3]">
        해당하는 기록이 없습니다.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-[#566999]">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="bg-[#2b364f] text-left text-xs text-[#ccd2e3]">
            <th className="whitespace-nowrap px-3 py-2 font-semibold">시각</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">한 일</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">누가</th>
            {showTenant && (
              <th className="whitespace-nowrap px-3 py-2 font-semibold">회사</th>
            )}
            <th className="px-3 py-2 font-semibold">내용</th>
            <th className="whitespace-nowrap px-3 py-2 font-semibold">IP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const failed = r.action === "auth.login_failed";
            return (
              <tr
                key={r.id}
                className="border-t border-[#4a5b87] bg-[#3d4e7a] align-top"
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-[#ccd2e3]">
                  {when(r.createdAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={
                      failed
                        ? "rounded px-1.5 py-0.5 text-xs font-semibold text-[#ff9a9e] bg-[#ff5a5f]/15"
                        : "text-xs font-medium"
                    }
                  >
                    {LABEL[r.action] ?? r.action}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {r.actorEmail ? (
                    <>
                      <span className="font-medium">{r.actorName}</span>
                      <span className="ml-1.5 text-xs text-[#ccd2e3]">
                        {r.actorEmail}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-[#98a2bd]">—</span>
                  )}
                </td>
                {showTenant && (
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[#ccd2e3]">
                    {r.tenantName ?? "—"}
                  </td>
                )}
                <td className="px-3 py-2 text-xs text-[#ccd2e3]">
                  {detail(r) || "—"}
                </td>
                <td
                  className="whitespace-nowrap px-3 py-2 font-mono text-xs text-[#ccd2e3]"
                  title={r.userAgent ?? ""}
                >
                  {ip(r.ipAddress)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
