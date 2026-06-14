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

// "super_admin" = 플랫폼 운영자(Chang) — tenant 생성/관리 권한. 다른 tenant 의
// 거래처/세션/이력은 *조회하지 않음* (코드 단계에서 강제). 격리 모델 깨끗.
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

// SaaS 멀티테넌트: 한 row = 한 대리점(회사). 사업자등록증/통장/연락처/구독
// 정보를 한 곳에 보관. 신규 컬럼 추가는 마이그레이션 006 참조.
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

  // 구독/요금 — monthly_fee_krw 는 공급가액(부가세 별도), UI 가 +VAT 10% 표시
  monthlyFeeKrw: integer("monthly_fee_krw"),
  paymentDay: integer("payment_day"),                // 매월 1~31
  paymentMethod: text("payment_method"),             // CHECK: cms|bank_transfer|credit_card
  subscriptionStartedAt: timestamp("subscription_started_at", { withTimezone: true }),
  subscriptionStatus: text("subscription_status").notNull().default("active"),
  notes: text("notes"),                              // 비고

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
    // 담당 직원 — 영업/주담당 표시용. 같은 tenant 내 모든 user 가 모든 customer 를
    // 볼 수 있도록 필터 강제는 안 함 (사내 운영 정책). 향후 SaaS 격리 시점에 정책 변경.
    assignedUserId: uuid("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    // 거래처 heartbeat (마이그레이션 007, 2026-05-26).
    // 거래처 (agent) 가 5~15분 주기로 NAS 에 자기 상태 보고. 관리 패널 / 본사 앱이
    // 마지막 접속 + 버전 가시화. 모든 컬럼 nullable — 옛 거래처는 lazy 채워짐.
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    lastVersion: text("last_version"),
    // 거래처별 random secret 의 sha-256 *해시* (H3, 2026-06-14). 평문은 agent LocalConfig 에만,
    // DB 엔 해시만 — 유출돼도 토큰 원본 비노출. 자가 발급 + idempotent rotation(호출마다 새 토큰,
    // v1.3.7, LocalConfig 토큰 분실 시 영구 stuck 회피). lib/heartbeat-token.ts 가 발급/해시 담당.
    heartbeatToken: text("heartbeat_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("idx_customers_tenant").on(t.tenantId),
    assignedIdx: index("idx_customers_assigned_user").on(t.tenantId, t.assignedUserId),
    // 멀티테넌트 격리 + heartbeat-token 안전(마이그레이션 011): remote_id 는 RustDesk 머신 ID
    // 라 글로벌 유일. 빈/NULL(거래처 ID 등록 전 placeholder) 은 제외하는 partial-unique.
    remoteIdUniq: uniqueIndex("uq_customers_remote_id")
      .on(t.remoteId)
      .where(sql`${t.remoteId} IS NOT NULL AND ${t.remoteId} <> ''`),
  }),
);

// 직원별 즐겨찾기 — 본사 앱의 "즐겨찾기" 탭은 로그인한 직원 본인의 것만,
// 관리 패널에서는 모든 직원의 즐겨찾기를 모두 조회 가능.
// 마이그레이션: 005_user_favorites.sql (최초), 008_user_favorites_orphan.sql (remote_id 기반 개편).
//
// 2026-05-27 개편: customers 에 없는 머신(HQ workstation, 옵션 B+ 본사 PC)도 즐겨찾기 가능하도록
// remote_id 를 primary 식별자로 사용. customer_id 는 customers 에 있는 경우에만 채움.
export const userFavorites = pgTable(
  "user_favorites",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    remoteId: text("remote_id").notNull(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

// 거래처 PC 푸시 업데이트 큐 (마이그레이션 009, 2026-05-29).
// Chang 이 관리 패널에서 "v1.3.5 푸시" 클릭 시 거래처별 1행 INSERT.
// Agent 가 자기 token + remote_id 로 5분 폴링 → 자기 행 발견하면 영업시간 가드 통과 후
// 사일런트 설치 → applied_at 채워서 보고. 일괄 푸시는 bulk_batch_id 로 N행 묶음.
//
// Pull 모델: NAS 가 Agent 에게 push 신호 안 쏨. Agent 가 자기 페이스로 폴링.
// → 2000+ 거래처 일괄 푸시해도 NAS 부하 = N개 INSERT 1회. 트래픽 분산은 Agent 무작위지연.
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
    // 24시간 영업/심야영업 거래처 보호 (Chang 결정 2026-05-29).
    windowStartHour: integer("window_start_hour").notNull().default(0),
    windowEndHour: integer("window_end_hour").notNull().default(7),
    // 무작위지연 상한 (초). Agent 가 푸시 감지 후 rand(0..randomizeMaxSec) 대기.
    // default 25200 = 7시간 창 전체. 2000+ 거래처 NAS/회선 부하 분산.
    randomizeMaxSec: integer("randomize_max_sec").notNull().default(25200),
    // 일괄 푸시 그룹 ID. 일괄=N행이 같은 UUID, 개별=NULL.
    bulkBatchId: uuid("bulk_batch_id"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    // 상태 timestamp — applied/cancelled/failed 중 1개만 채워짐. 미채워짐 = 대기 중.
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Agent 폴링은 (tenant, customer, status=대기) 로 1행만 픽업.
    customerIdx: index("idx_pending_updates_customer").on(t.tenantId, t.customerId),
    // 관리 패널의 일괄 진행률 조회 ("v1.3.5 적용 1847/2000").
    bulkIdx: index("idx_pending_updates_bulk").on(t.bulkBatchId),
    // 거래처 표의 "대기 중 업데이트 있음" 배지 조회.
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

// 좌석 과금 — 단일 동시세션 enforcement (마이그레이션 010, 2026-06-04 Chang 결정).
// 한 HQ 계정 = 동시 1세션. user_id PK 로 계정당 active 1건 강제. takeover = UPSERT.
// HQ 앱이 ~10초 heartbeat 로 last_seen_at 갱신. jti 불일치 = 인계당함 = REVOKED.
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
