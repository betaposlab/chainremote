// GET /api/manuals/[slug] — 매뉴얼 PDF 를 흘려보낸다.
//
// 파일을 public/ 에 두지 않은 이유는 lib/manuals.ts 주석에 있다. 요약하면 HQ·패널 매뉴얼에
//   원격 ID 체계와 enroll-key 배포 흐름이 통째로 들어 있어 URL 만 알면 열리는 자리에
//   두면 안 된다. 그래서 여기서 세션을 보고 통과시킨다. **예외는 없다** — 네 편 모두
//   로그인해야 열린다.
//
// 세션 쿠키의 존재가 아니라 **계정 생존**을 본다(getLiveUser). 퇴사자 쿠키는 만료 전까지
//   7일간 유효해 보이는데, 그동안 매뉴얼이 계속 받아지면 차단이 반쪽이다 —
//   설치파일 라우트(api/tenants/[id]/chaingo)와 같은 기준으로 맞춰 둔다.
//
// ?dl=1 이면 첨부(내려받기), 아니면 inline(브라우저 내장 뷰어로 바로 보기).

import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { getLiveUser } from "@/lib/auth-guard";
import { findManual } from "@/lib/manuals";

export const dynamic = "force-dynamic";

// standalone 빌드의 cwd 는 /app 이고 Dockerfile 이 /app/manuals 로 복사해 둔다.
// 개발 중에는 프로젝트 루트가 그대로 cwd 라 같은 경로가 맞는다.
const MANUAL_DIR = path.join(process.cwd(), "manuals");

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;

  // 표에 없는 이름은 여기서 끝난다 — slug 를 경로로 쓰기 전에 화이트리스트로 거른다.
  //   (`../` 같은 걸 넣어도 표에 없으니 파일 경로가 만들어지지 않는다)
  const m = findManual(slug);
  if (!m) return new Response("매뉴얼을 찾을 수 없습니다", { status: 404 });

  const me = await getLiveUser();
  if (!me) return new Response("로그인이 필요합니다", { status: 403 });

  const file = path.join(MANUAL_DIR, m.file);
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    // 파일이 빠진 채 배포된 경우. 화면에 404 를 주면 "매뉴얼이 없는 것"처럼 보이므로
    //   500 으로 구분해 둔다 — 배포 사고지 문서가 없는 게 아니다.
    return new Response("매뉴얼 파일이 서버에 없습니다", { status: 500 });
  }

  const download = new URL(req.url).searchParams.get("dl") === "1";
  // 한글 파일명은 RFC 5987 filename* 로 넘긴다. filename= 만 쓰면 브라우저가 깨뜨린다.
  const encoded = encodeURIComponent(m.downloadName);
  const disposition = `${download ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`;

  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(size),
      "Content-Disposition": disposition,
      // 중간 캐시에 남기지 않는다 — 공용 PC 뒤로가기로 남의 매뉴얼이 뜨면 곤란하다.
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
