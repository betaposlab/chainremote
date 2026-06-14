// 거래처 heartbeat 토큰 유틸 (H3 — 평문 저장 제거).
//
// 보안 모델: 평문 토큰은 agent 의 LocalConfig 에만 존재하고, 서버 DB(customers.heartbeat_token)
// 에는 sha-256 *해시* 만 저장한다. agent 는 평문을 그대로 X-ChainRemote-Token 헤더로 보내고
// 서버가 해시해서 대조하므로 **agent(클라이언트) 측 변경은 불필요** — DB 유출 시에도 토큰 원본이
// 노출되지 않는다. (sha-256 단방향, salt 불필요: 토큰은 256-bit 고엔트로피 랜덤이라 rainbow/brute 무의미.)
//
// 마이그레이션: 별도 DB 스키마 변경 없음(컬럼은 여전히 64-hex 문자열). 기존 평문 토큰을 가진
// 거래처는 다음 heartbeat 가 403 → agent self-heal(v1.3.7) 로 재등록 → 해시 토큰으로 자동 교체된다.

import crypto from "node:crypto";

/** 새 평문 토큰 발급 (agent 에 반환할 64-hex). */
export function generateHeartbeatToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** 평문 토큰 → 저장/대조용 sha-256 hex. 앞뒤 공백은 무시. */
export function hashHeartbeatToken(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}
