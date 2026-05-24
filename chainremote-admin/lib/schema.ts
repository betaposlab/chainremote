import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  pgEnum,
  index,
  integer,
  bigserial,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index("idx_customers_tenant").on(t.tenantId),
    assignedIdx: index("idx_customers_assigned_user").on(t.tenantId, t.assignedUserId),
  }),
);

// 직원별 즐겨찾기 — 본사 앱의 "즐겨찾기" 탭은 로그인한 직원 본인의 것만,
// 관리 패널에서는 모든 직원의 즐겨찾기를 모두 조회 가능.
// 마이그레이션: db/migrations/005_user_favorites.sql
export const userFavorites = pgTable(
  "user_favorites",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.customerId] }),
    userIdx: index("idx_user_favorites_user").on(t.userId),
    customerIdx: index("idx_user_favorites_customer").on(t.customerId),
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
