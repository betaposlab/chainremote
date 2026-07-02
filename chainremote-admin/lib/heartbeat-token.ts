// 거래처 heartbeat 토큰 유틸. DB 엔 평문 대신 해시만 저장.
//
// 평문 토큰은 agent LocalConfig 에만 있고, 서버 DB 엔 sha-256 해시만 둔다. agent 가
// 평문을 X-ChainRemote-Token 헤더로 보내면 서버가 해시해서 대조 — agent 측 변경은 없고
// DB 가 유출돼도 원본은 안 샌다. (256-bit 랜덤이라 salt 없이 sha-256 로 충분: rainbow/brute 무의미.)
//
// DB 스키마 변경 없음(컬럼은 여전히 64-hex). 옛 평문 토큰을 가진 거래처는 다음 heartbeat 가
// 403 나면 agent self-heal(v1.3.7)로 재등록해 해시 토큰으로 자동 교체된다.

import crypto from "node:crypto";

/** 새 평문 토큰 발급 (agent 에 반환할 64-hex). */
export function generateHeartbeatToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** 평문 토큰 → 저장/대조용 sha-256 hex. 앞뒤 공백은 무시. */
export function hashHeartbeatToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}
