// GET /api/customers/watch?remoteId=XXX
//   HQ 우클릭 관제 다이얼로그가 "지금 켜져 있나"를 묻는 창구.
//
//   왜 서버에 직접 묻나: HQ 의 최근 세션 탭은 거래처를 로컬 peer 캐시에서 읽는다(패널이 아님).
//   그 캐시엔 관제 필드가 아예 없어서, 빈 값을 그대로 그리면 켜 둔 거래처도 "꺼짐"으로 뜬다
//   (2026-08-10 실측 — 없는 표시보다 나쁜 거짓 표시였다). 어느 탭에서 열든 정확하려면
//   화면을 열 때 서버가 진실을 말해 줘야 한다. 다른 직원이 방금 바꾼 값도 이 경로로 반영된다.
//
//   viewer 도 볼 수 있다(읽기 전용). 남의 tenant 거래처는 getWatchState 가 tenant 로 막는다.

import { requireApiAuth, jsonError, ApiAuthError } from "@/lib/api-auth";
import { getWatchState } from "@/lib/data/customers";
import { doorIsOpen } from "@/lib/data/upnp-probe";

export async function GET(req: Request) {
  try {
    const me = await requireApiAuth(req);
    const remoteId = (new URL(req.url).searchParams.get("remoteId") ?? "").trim();
    if (!remoteId) throw new ApiAuthError(400, "remoteId 필수");
    const row = await getWatchState(remoteId, me.tenantId);
    if (!row) return Response.json({ error: "거래처 없음" }, { status: 404 });
    return Response.json({
      firewallControl: row.firewallControl,
      vanWatch: row.vanWatch ?? "",
      // null = 아직 보고 전(방금 켰거나 기기가 꺼져 있음). false 와 구분해야 한다.
      vanOk: row.vanOk,
      vanGaveUp: row.vanGaveUp,
      vanMissing: row.vanMissing,
      // ★이 숫자는 "되살린 횟수"가 아니라 **실행시킨 횟수**다(마이그051 주석 참조).
      //   성패는 아래 둘이 센다 — 현재 HQ 는 아직 안 읽지만, 다음 HQ 가 문구를 고칠 때
      //   서버를 다시 건드리지 않도록 미리 실어 둔다(모르는 키는 무시된다).
      vanRestartCount: row.vanRestartCount,
      vanRecoveredCount: row.vanRecoveredCount,
      vanUnrecoveredCount: row.vanUnrecoveredCount,
      // 공유기 포트 열기(041) — 켜짐 여부 + 공유기가 열었다고 한 주소(없으면 null).
      upnpEnabled: row.upnpEnabled,
      upnpEndpoint: row.upnpEndpoint,
      // ★그 주소가 바깥에서 진짜 열려 있는지(042). 주소만 보고 "열림"이라 쓰면 거짓말이 된다 —
      //   매핑을 등록해 놓고도 안 넘기는 공유기가 실재한다(우리집 실측). 여기서 서버가
      //   판정해 내려보내야 신선도 기준(6시간)이 한 곳에만 있게 된다.
      upnpDoorOpen: doorIsOpen(row),
      upnp: row.upnp,
    });
  } catch (e) {
    return jsonError(e);
  }
}
