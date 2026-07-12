import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  integer,
  bigserial,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// "super_admin" = 플랫폼 운영자(Chang) — tenant 생성/관리용. 다른 tenant 의
// 거래처/세션/이력은 코드 단에서 막아 못 본다.
export const userRole = pgEnum("user_role", [
  "owner",
  "admin",
  "operator",
  "viewer",
  "super_admin",
]);
export const issueType = pgEnum("issue_type", [
  "config",
  "hardware",
  "software",
  "network",
  "training",
  "other",
]);
export const resolutionStatus = pgEnum("resolution_status", [
  "resolved",
  "pending",
  "escalated",
  "in_progress",
]);

// 한 row = 한 대리점(회사). 사업자등록증/통장/연락처/구독 정보를 여기 모은다.
// 컬럼 추가는 마이그 006 참조.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  plan: text("plan").notNull().default("free"),
  isActive: boolean("is_active").notNull().default(true),

  // 사업자 정보 (사업자등록증 기준)
  businessNo: text("business_no"),                   // 사업자등록번호
  representativeName: text("representative_name"),   // 대표자명
  businessAddress: text("business_address"),         // 사업장 주소
  businessType: text("business_type"),               // 업태
  businessItem: text("business_item"),               // 종목

  // 연락처
  companyPhone: text("company_phone"),
  representativePhone: text("representative_phone"),
  contactPhone: text("contact_phone"),

  // 결제 계좌 (통장사본)
  bankName: text("bank_name"),
  bankAccount: text("bank_account"),
  bankHolder: text("bank_holder"),

  // 구독/요금 — monthly_fee_krw 는 공급가액(부가세 별도). UI 가 +VAT 10% 붙여 표시.
  monthlyFeeKrw: integer("monthly_fee_krw"),
  paymentDay: integer("payment_day"),                // 매월 1~31
  paymentMethod: text("payment_method"),             // CHECK: cms|bank_transfer|credit_card
  subscriptionStartedAt: timestamp("subscription_started_at", { withTimezone: true }),
  subscriptionStatus: text("subscription_status").notNull().default("active"),
  notes: text("notes"),                              // 비고
  // agent 자가등록(auto-enroll) 인증용 per-tenant enroll-key 의 sha-256 해시.
  // 평문은 그 tenant 의 agent 빌드 custom.txt 에만. NULL = 자가등록 끔. 마이그 016.
  enrollSecretHash: text("enroll_secret_hash"),
  // 같은 enroll-key 평문을 AUTH_SECRET 파생키로 AES-256-GCM 암호화 보관 (마이그 017).
  // 다운로드 때 복호화해 같은 키를 재사용 → 재다운로드해도 같은 .exe (대리점 자가 다운로드).
  enrollSecretEnc: text("enroll_secret_enc"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: userRole("role").notNull().default("operator"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    // HQ 데스크탑앱이 heartbeat 로 보고 — 패널에서 직원별 HQ 버전/생존을 본다.
    // customers.lastVersion/lastHeartbeatAt 의 HQ 판. 마이그 014.
    lastVersion: text("last_version"),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index("idx_users_tenant").on(t.tenantId) }),
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    address: text("address"),
    remoteId: text("remote_id"),
    accessPassword: text("access_password"),
    notes: text("notes"),
    // 담당 직원 — 표시용. 같은 tenant 안에선 모든 user 가 모든 customer 를 보게
    // 두고 필터는 안 건다 (사내 운영 정책). SaaS 격리 시점에 재검토.
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    // 거래처 heartbeat (마이그 007, 2026-05-26).
    // agent 가 5~15분마다 NAS 에 자기 상태 보고 → 패널/본사 앱이 마지막 접속 + 버전
    // 표시. 전부 nullable — 옛 거래처는 lazy 채워진다.
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    lastVersion: text("last_version"),
    // 거래처별 random secret 의 sha-256 해시 (2026-06-14). 평문은 agent LocalConfig 에만,
    // DB 엔 해시만 두어 유출돼도 원본은 안 샌다. 자가 발급 + rotation(호출마다 새 토큰,
    // v1.3.7 — LocalConfig 토큰 분실로 영영 stuck 되던 걸 회피). lib/heartbeat-token.ts 담당.
    heartbeatToken: text("heartbeat_token"),
    // 기기지문 앵커(마이그 018). machine_uid(Windows=MachineGuid) — remote_id 보다 안정적.
    // ID 가 충돌/랜카드교체로 바뀌어도 지문으로 같은 거래처를 알아봐 remote_id 만 갱신한다.
    // nullable: 옛 거래처 + 지문 못 읽는 기기는 NULL 로 두어 매칭에서 빼 오매칭 방지.
    machineUuid: text("machine_uuid"),
    // 프로세스 arch(마이그 020) — "x86"(32비트 페이로드) / "x64". heartbeat 가 lazy 채운다.
    //   ★순수 표시·진단용 telemetry — 매칭/신원 키가 절대 아니다(machine_uuid 와 다른 점).
    //   내부 진단용(어느 페이로드/버전 트랙인지). 표시는 os/osBits 를 쓴다. nullable(옛/미보고).
    arch: text("arch"),
    // OS 표시(마이그 021) — os="Windows 7/10/11", osBits="x64"/"x86"(네이티브 OS 비트수).
    //   arch(페이로드)와 다르다: 64비트 Win7 은 arch="x86"이나 os="Windows 7"·osBits="x64".
    //   "Win7 · 64비트"로 정확히 보여줘 arch 만 볼 때의 착각 방지. 표시·진단용, 매칭 키 아님.
    os: text("os"),
    osBits: text("os_bits"),
    // 내부 기기(본사/Mac/빌드머신 — 진짜 거래처 아님, 마이그 013). true 면 일괄푸시에서 빼고
    // UI 에서 버전/푸시 숨김. pin_order = 표 상단 고정 순서(1=최상단, NULL=일반 거래처).
    isInternal: boolean("is_internal").notNull().default(false),
    pinOrder: integer("pin_order"),
    // auto-enroll 상태: 'active'(확정) | 'pending'(agent 자가등록 후보 — HQ 패널 확인 대기).
    // 기존/수동추가(importPeer·createCustomer) 거래처는 default 'active'. 마이그 016.
    enrollStatus: text("enroll_status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("idx_customers_tenant").on(t.tenantId),
    assignedIdx: index("idx_customers_assigned_user").on(t.tenantId, t.assignedUserId),
    enrollStatusIdx: index("idx_customers_enroll_status").on(t.tenantId, t.enrollStatus),
    // 멀티테넌트 격리 + heartbeat-token 안전(마이그 011): remote_id 는 RustDesk 머신 ID 라
    // 글로벌 유일. 빈/NULL(거래처 ID 등록 전 placeholder) 은 빼는 partial-unique.
    remoteIdUniq: uniqueIndex("uq_customers_remote_id")
      .on(t.remoteId)
      .where(sql`${t.remoteId} IS NOT NULL AND ${t.remoteId} <> ''`),
    // 기기지문 앵커(마이그 018). 테넌트 내 한 기기 = 한 거래처. 빈/NULL 빼는 partial-unique
    // 라 지문 못 읽는 기기들끼리 오매칭되지 않는다.
    machineUuidIdx: index("idx_customers_machine_uuid").on(t.tenantId, t.machineUuid),
    machineUuidUniq: uniqueIndex("uq_customers_machine_uuid")
      .on(t.tenantId, t.machineUuid)
      .where(sql`${t.machineUuid} IS NOT NULL AND ${t.machineUuid} <> ''`),
  }),
);

// 직원별 즐겨찾기 — 본사 앱의 "즐겨찾기" 탭은 본인 것만, 패널은 전 직원 것을 다 본다.
// 마이그: 005_user_favorites.sql (최초), 008_user_favorites_orphan.sql (remote_id 기반 개편).
//
// 2026-05-27 개편: customers 에 없는 머신(HQ workstation, 옵션 B+ 본사 PC)도 즐겨찾기 되도록
// remote_id 를 primary 식별자로. customer_id 는 customers 에 있을 때만 채운다.
export const userFavorites = pgTable(
  "user_favorites",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    remoteId: text("remote_id").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    hostname: text("hostname"),
    alias: text("alias"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.remoteId] }),
    userIdx: index("idx_user_favorites_user").on(t.userId),
    customerIdx: index("idx_user_favorites_customer").on(t.customerId),
    remoteIdx: index("idx_user_favorites_remote_id").on(t.remoteId),
    tenantIdx: index("idx_user_favorites_tenant").on(t.tenantId),
  }),
);

export const supportSessions = pgTable(
  "support_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    operatorId: uuid("operator_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSec: integer("duration_sec"),
    remoteId: text("remote_id"),
    customerIp: text("customer_ip"),
    issueType: issueType("issue_type"),
    resolution: resolutionStatus("resolution"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ startedIdx: index("idx_sessions_tenant_started").on(t.tenantId, t.startedAt) }),
);

// 거래처 PC 푸시 업데이트 큐 (마이그 009, 2026-05-29).
// Chang 이 패널에서 "v1.3.5 푸시" 하면 거래처별 1행 INSERT. Agent 가 자기 token +
// remote_id 로 5분 폴링, 자기 행을 찾으면 영업시간 가드 통과 후 사일런트 설치하고
// applied_at 채워 보고. 일괄 푸시는 bulk_batch_id 로 N행을 묶는다.
//
// Pull 모델 — NAS 가 push 신호를 쏘지 않고 Agent 가 자기 페이스로 폴링. 2000+ 거래처를
// 일괄 푸시해도 NAS 부하는 INSERT N행 1회뿐. 트래픽 분산은 Agent 무작위지연이 맡는다.
export const pendingUpdates = pgTable(
  "pending_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    // 타겟 버전 + 인스톨러 자산. NAS 에 호스팅된 .exe 메타.
    targetVersion: text("target_version").notNull(),
    assetUrl: text("asset_url").notNull(),
    assetSha256: text("asset_sha256").notNull(),
    assetSize: integer("asset_size").notNull(),
    // 영업시간 가드 (0~23 시). default 00:00~07:00 = 자정~새벽7시 무인적용.
    // 24시간/심야영업 거래처 보호 (Chang 결정 2026-05-29).
    windowStartHour: integer("window_start_hour").notNull().default(0),
    windowEndHour: integer("window_end_hour").notNull().default(7),
    // 무작위지연 상한 (초). Agent 가 푸시 감지 후 rand(0..randomizeMaxSec) 만큼 대기.
    // default 25200 = 7시간 창 전체. 2000+ 거래처 NAS/회선 부하 분산용.
    randomizeMaxSec: integer("randomize_max_sec").notNull().default(25200),
    // 일괄 푸시 그룹 ID. 일괄=N행이 같은 UUID, 개별=NULL.
    bulkBatchId: uuid("bulk_batch_id"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    // 상태 timestamp — applied/cancelled/failed 중 하나만 채워진다. 셋 다 비면 대기 중.
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Agent 폴링이 (tenant, customer, status=대기) 로 1행만 집어간다.
    customerIdx: index("idx_pending_updates_customer").on(t.tenantId, t.customerId),
    // 패널 일괄 진행률 ("v1.3.5 적용 1847/2000").
    bulkIdx: index("idx_pending_updates_bulk").on(t.bulkBatchId),
    // 거래처 표의 "대기 중 업데이트 있음" 배지.
    tenantIdx: index("idx_pending_updates_tenant").on(t.tenantId),
  }),
);

export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: uuid("target_id"),
  metadata: jsonb("metadata"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 좌석 과금 — 단일 동시세션 enforcement (마이그 010, 2026-06-04 Chang 결정).
// 한 HQ 계정 = 동시 1세션. user_id PK 로 계정당 active 1건만 강제, takeover 는 UPSERT.
// HQ 앱이 ~10초 heartbeat 로 last_seen_at 갱신. jti 불일치면 인계당한 것 = REVOKED.
// 백워드 호환(§8): 옛 앱(device_id 미전송)은 이 테이블에 행을 안 만든다.
// 상세: docs/chainremote/SEAT_ENFORCEMENT.md
export const activeLoginSessions = pgTable(
  "active_login_sessions",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    jti: uuid("jti").notNull(),
    deviceId: text("device_id").notNull(),
    deviceLabel: text("device_label"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lastSeenIdx: index("idx_active_login_sessions_last_seen").on(t.lastSeenAt),
  }),
);
