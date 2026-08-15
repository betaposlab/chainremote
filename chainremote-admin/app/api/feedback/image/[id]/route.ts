// 문의 첨부 이미지 서빙. ★이 라우트가 격리의 전부다.
//
// 파일을 공개 정적 경로에 두지 않는 이유가 여기 있다 — URL 만 알면 남의 대리점
//   스크린샷이 열리기 때문이다. POS 화면에는 매출·고객정보가 찍혀 있을 수 있다.
//   목록 조회는 tenant_id 로 자동으로 잘리지만 파일은 그렇지 않아 명시적으로 막는다.

import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getLiveUser } from "@/lib/auth-guard";
import { getImageForServe } from "@/lib/data/feedback";
import { resolveStoredPath } from "@/lib/feedback-upload";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  // 세션 쿠키의 존재가 아니라 계정 생존을 본다 — 퇴사자가 설치파일을 계속 받아가면
  //   차단이 반쪽이다(에이전트 exe 에는 대리점 enroll-key 가 박힌다).
  const session = { user: await getLiveUser() };
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isFinite(id)) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const me = session.user;
  const row = await getImageForServe(
    id,
    me.role === "super_admin" ? { platform: true } : { tenantId: me.tenantId },
  );
  // 남의 대리점 이미지도 "없음"으로 답한다 — 있다/없다가 새면 그 자체가 정보다.
  if (!row) return new NextResponse("Not Found", { status: 404 });

  const filePath = resolveStoredPath(row.storedName);
  if (!filePath) return new NextResponse("Not Found", { status: 404 });

  try {
    const buf = await readFile(filePath);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": row.mimeType,
        // inline 이되 파일명은 넘긴다(저장 시 원본 이름 유지).
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
        // 인증이 필요한 자원이라 공용 캐시에 남으면 안 된다.
        "Cache-Control": "private, max-age=3600",
        // 혹시라도 브라우저가 타입을 다시 추측하지 않게.
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    // DB 행은 있는데 파일이 없다 = 정리 작업과 겹쳤거나 디스크에서 사라진 것.
    return new NextResponse("Not Found", { status: 404 });
  }
}
