-- 010: 좌석 과금 — 단일 동시세션 enforcement (코이노식 takeover, 2026-06-04 Chang 결정).
--
-- 사업화 좌석 과금의 핵심. 한 HQ 계정 = 동시 1세션.
-- 같은 아이디로 다른 기기에서 로그인하면 "다른 기기 사용 중" 모달이 뜨고, 강제 종료(takeover)를 고르면
-- 옛 기기의 RustDesk 세션이 끊기고 로그아웃되며, 취소하면 토큰을 발급하지 않는다.
--
-- 모델: user_id PK 로 계정당 active 1건을 강제하고, takeover 는 UPSERT(덮어쓰기)로 처리한다.
-- HQ 앱이 ~10초 heartbeat 로 last_seen_at 을 갱신하다가 자기 jti 가 active 와 어긋나면 인계당한 것 —
-- 앱이 스스로 disconnect + 로그아웃한다(서버는 revoke 신호만 주고 실행은 클라 몫).
--
-- 기존 테이블은 안 건드리고 추가만 하므로 안전하다. 옛 앱(device_id 미전송)은 이 테이블에 행을 안 만들어
-- enforcement 가 적용되지 않으므로 전환기 동안 옛/새 앱이 공존한다(스펙 §8).
-- 상세 설계: docs/chainremote/SEAT_ENFORCEMENT.md

CREATE TABLE IF NOT EXISTS active_login_sessions (
    user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,  -- 계정당 1행 (단일세션)
    jti          uuid NOT NULL,           -- 현재 유효 토큰 식별 (JWT jti claim)
    device_id    text NOT NULL,           -- machine_uid (RustDesk main_get_uuid)
    device_label text,                     -- "재성이-PC" 등 표시용 (호스트명)
    ip           text,
    created_at   timestamptz NOT NULL DEFAULT now(),   -- 이 기기가 좌석 점유 시작한 시각
    last_seen_at timestamptz NOT NULL DEFAULT now()    -- heartbeat 갱신 (orphan TTL 판정)
);

-- orphan(heartbeat 끊긴 죽은 세션) 판정/청소용. orphan TTL = 2분 (스펙 §7).
CREATE INDEX IF NOT EXISTS idx_active_login_sessions_last_seen
    ON active_login_sessions (last_seen_at);
