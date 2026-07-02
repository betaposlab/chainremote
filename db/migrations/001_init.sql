-- ChainRemote 초기 스키마
-- 설계 원칙: 첫날부터 멀티테넌시(SaaS) 전제 — 모든 비-tenant 테이블은 tenant_id 를 갖는다.

-- 확장
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. 테넌트 (사업장 — 향후 SaaS 시 고객사)
CREATE TABLE tenants (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug          TEXT NOT NULL UNIQUE,           -- URL-safe ASCII 식별자
    display_name  TEXT NOT NULL,                  -- 한글 표시명 가능
    plan          TEXT NOT NULL DEFAULT 'free',   -- 향후 과금 대비
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 사용자 (관리자/직원)
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'operator', 'viewer');

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    password_hash   TEXT NOT NULL,                -- bcrypt/argon2
    display_name    TEXT NOT NULL,
    role            user_role NOT NULL DEFAULT 'operator',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE INDEX idx_users_tenant ON users(tenant_id);

-- 3. 거래처 (우리 사업장의 손님 = POS/키오스크 설치처)
CREATE TABLE customers (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,                  -- 상호
    contact_name  TEXT,                           -- 담당자 이름
    phone         TEXT,
    address       TEXT,
    rustdesk_id   TEXT,                           -- 거래처 PC의 RustDesk ID (9자리, 알면 자동 접속)
    notes         TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_rustdesk_id ON customers(tenant_id, rustdesk_id);

-- 4. 지원 세션 (원격 지원 기록)
CREATE TYPE issue_type AS ENUM (
    'config',           -- 설정 문제
    'hardware',         -- 하드웨어 고장
    'software',         -- 소프트웨어 오류
    'network',          -- 네트워크 문제
    'training',         -- 사용법 안내
    'other'
);

CREATE TYPE resolution_status AS ENUM (
    'resolved',         -- 해결
    'pending',          -- 보류
    'escalated',        -- 직접 지원 필요
    'in_progress'       -- 진행 중
);

CREATE TABLE support_sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
    operator_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at      TIMESTAMPTZ,
    duration_sec  INTEGER GENERATED ALWAYS AS (
        CASE WHEN ended_at IS NOT NULL
             THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
             ELSE NULL END
    ) STORED,
    rustdesk_id   TEXT,                           -- 자동 캡처 가능
    customer_ip   INET,
    issue_type    issue_type,
    resolution    resolution_status,
    description   TEXT,                           -- 자유 메모
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_tenant_started ON support_sessions(tenant_id, started_at DESC);
CREATE INDEX idx_sessions_customer ON support_sessions(customer_id);

-- 5. 채팅 (Step 6에서 활성화 — 지금은 스키마만)
CREATE TABLE session_messages (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id    UUID NOT NULL REFERENCES support_sessions(id) ON DELETE CASCADE,
    sender        TEXT NOT NULL,                  -- 'operator' | 'customer'
    content       TEXT NOT NULL,
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_session ON session_messages(session_id, sent_at);

-- 6. 감사 로그 (보안: 누가 언제 무엇을)
CREATE TABLE audit_logs (
    id            BIGSERIAL PRIMARY KEY,
    tenant_id     UUID REFERENCES tenants(id) ON DELETE SET NULL,
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    action        TEXT NOT NULL,                  -- 'login', 'view_customer', 'remote_connect', etc.
    target_type   TEXT,                           -- 'customer', 'session', etc.
    target_id     UUID,
    metadata      JSONB,
    ip_address    INET,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC);

-- 자동 updated_at 트리거
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- 초기 시드: 베타포스랩 테넌트
INSERT INTO tenants (slug, display_name, plan)
VALUES ('betaposlab', '베타포스랩', 'free');
