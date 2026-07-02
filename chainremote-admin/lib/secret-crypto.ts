// per-tenant enroll-key 평문을 DB 에 암호화 저장하는 유틸 (AES-256-GCM).
//
// 대리점이 에이전트를 여러 번 받아도 같은 .exe(같은 키)가 나와야 한다 — 매번 키를 돌리면
// 이미 배포한 .exe 가 신규등록 불가가 되니까. 그래서 평문을 재생성 가능하게 두되, 그냥
// 두지 않고 AUTH_SECRET 파생 키로 암호화한다. 검증용 sha-256 해시(enroll_secret_hash)는
// 따로 저장해 resolveTenantByEnroll 이 대조한다.
//
// 포맷: base64( iv(12) || authTag(16) || ciphertext ). 키 = sha256(AUTH_SECRET).

import crypto from "crypto";

function aesKey(): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET 환경변수 없음");
  return crypto.createHash("sha256").update(s).digest(); // 32 bytes
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(enc: string): string {
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
