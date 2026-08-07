// 문의 첨부 이미지 — 검증과 디스크 저장. ★서버 전용(node:fs 를 쓴다).
//
// 검증을 세 겹으로 하는 이유: 확장자는 사용자가 정하고, MIME 헤더도 브라우저가 보내는
//   값이라 둘 다 위조된다. 실제로 무엇인지 아는 건 파일 앞머리 몇 바이트뿐이다.
//   ★SVG 를 아예 안 받는 것도 같은 맥락이다 — SVG 는 스크립트를 품을 수 있어서
//   "이미지인 척하는 XSS" 통로가 된다. 매직바이트로도 텍스트라 걸러내기 애매하다.

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_IMAGES_PER_FEEDBACK = 3;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

/** 컨테이너에 bind mount 되는 경로. 호스트에서도 같은 디렉토리를 보므로 정리 작업이 쉽다. */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || "/data/uploads/feedback";

const SIGNATURES: { mime: string; ext: string; match: (b: Uint8Array) => boolean }[] = [
  {
    mime: "image/png",
    ext: "png",
    match: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: "image/jpeg",
    ext: "jpg",
    match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    // RIFF....WEBP — 4바이트 크기 필드를 건너뛰고 8번째부터가 'WEBP'
    mime: "image/webp",
    ext: "webp",
    match: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
];

export interface StoredImage {
  storedName: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
}

/**
 * 파일 하나를 검증하고 디스크에 쓴다. 파일명은 서버가 만든다 —
 * 원본 이름을 그대로 쓰면 경로 조작(../)과 한글·공백 문제가 따라온다.
 */
export async function storeImage(file: File): Promise<StoredImage> {
  if (file.size <= 0) throw new Error("빈 파일입니다.");
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `이미지는 장당 ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)}MB 까지입니다.`,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sig = SIGNATURES.find((s) => s.match(bytes));
  if (!sig) {
    throw new Error("PNG·JPG·WEBP 이미지만 첨부할 수 있습니다.");
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const storedName = `${randomUUID()}.${sig.ext}`;
  await writeFile(path.join(UPLOAD_DIR, storedName), bytes);

  return {
    storedName,
    // 표시용으로만 쓴다. 화면에 넣을 때 이스케이프는 React 가 한다.
    originalName: (file.name || "image").slice(0, 200),
    mimeType: sig.mime,
    byteSize: bytes.byteLength,
  };
}

/** 디스크에서 지운다. 이미 없으면 조용히 넘어간다 — 정리 작업이 두 번 돌 수 있다. */
export async function removeStoredImage(storedName: string): Promise<void> {
  // 방어: DB 값이라 신뢰하지만, 경로 구분자가 섞이면 디렉토리 밖을 건드릴 수 있다.
  if (storedName.includes("/") || storedName.includes("\\") || storedName.includes("..")) {
    return;
  }
  try {
    await unlink(path.join(UPLOAD_DIR, storedName));
  } catch {
    // ENOENT 등은 무시 — 파일이 없다는 결과는 같다.
  }
}

/** 서빙 라우트가 읽을 절대 경로. 위와 같은 방어를 거친다. */
export function resolveStoredPath(storedName: string): string | null {
  if (storedName.includes("/") || storedName.includes("\\") || storedName.includes("..")) {
    return null;
  }
  return path.join(UPLOAD_DIR, storedName);
}
