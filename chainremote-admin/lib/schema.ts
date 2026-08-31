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
  bigint,
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
  // 좌석 상한(마이그 027) — 이 대리점이 만들 수 있는 활성 아이디(=동시 세션) 수.
  //   신규 기본 1. super_admin 보유 본사는 9999(무제한). owner 는 이 한도 내에서만 직원 추가,
  //   상한 조정은 super_admin 만. "1 아이디 = 동시 1세션"(마이그 010)과 짝을 이뤄 과금을 막는다.
  maxSeats: integer("max_seats").notNull().default(1),

  // 거래처 수락창에 보일 상호(마이그 029). 비면 displayName 폴백.
  //   패널 로그인용 회사명과 거래처에 내세우는 영업 상호가 다를 수 있어 따로 둔다 —
  //   우리가 그 사례다(계정 베타포스랩 / 거래처엔 대전문성텔레콤).
  supportDisplayName: text("support_display_name"),

  // 무인접속 에이전트(마이그 030). 켜면 [에이전트 다운로드] 의 custom.txt 가
  //   approve-mode=both 로 나간다 — 영구비번이 있을 때만 무클릭이고 없으면 수락창
  //   폴백이라 잘못 켜도 열린 문이 되진 않는다. 거래처용 클릭수락 정책은 그대로다.
  unattendedAgent: boolean("unattended_agent").notNull().default(false),

  // HQ 정보 화면 이스터에그 문구(마이그 030). 비면 표시 안 함.
  //   코드가 아니라 DB 에 두는 이유: HQ 는 빌드가 한 벌이라 코드에 박으면 전 대리점에
  //   보이고, 이 저장소는 AGPL 공개 소스다.
  hqGreeting: text("hq_greeting"),

  // 사업자 정보 (사업자등록증 기준)
  businessNo: text("business_no"),                   // 사업자등록번호
  representativeName: text("representative_name"),   // 대표자명
  businessAddress: text("business_address"),         // 사업장 주소
  businessType: text("business_type"),               // 업태
  businessItem: text("business_item"),               // 종목

  // 연락처
  companyPhone: text("company_phone"),
  // 대리점 연락 이메일(마이그047) — 세금계산서·구독 안내를 받는 주소.
  //   로그인 아이디(users.email)와 다른 값이다: 아이디는 'chang' 처럼 이메일이 아닐 수 있고
  //   청구는 대개 경리 담당자 주소로 간다.
  contactEmail: text("contact_email"),
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
    // 디스크 관제(마이그 024) — heartbeat 가 C드라이브 용량 보고. 표시·경고용 telemetry.
    //   tempBytes 는 여유 부족일 때만 에이전트가 측정해 보내는 선택 필드(원인 표시용).
    diskTotalBytes: bigint("disk_total_bytes", { mode: "number" }),
    diskFreeBytes: bigint("disk_free_bytes", { mode: "number" }),
    tempBytes: bigint("temp_bytes", { mode: "number" }),
    // 용량을 먹는 폴더 상위(마이그 044) — [{name, bytes}] 최대 8개. 재기만 하고 지우지 않는다.
    //   Temp 를 비워도 여유가 안 늘어나는 기기의 진짜 범인을 데이터로 확인하려는 것.
    //   여기 쌓인 걸 보고 정리 대상을 정한다(짐작으로 지우면 앱이 깨진다).
    topDirs: jsonb("top_dirs").$type<{ name: string; bytes: number }[]>(),
    diskReportedAt: timestamp("disk_reported_at", { withTimezone: true }),
    // 원격 Temp 정리 명령 큐 — 버튼이 now() 를 찍고, 에이전트가 heartbeat 응답에서 받아
    //   실행 후 결과(JSON)를 보고하면 requested 가 비워진다. 자동업뎃 푸시와 같은 결.
    cleanupRequestedAt: timestamp("cleanup_requested_at", { withTimezone: true }),
    cleanupResult: text("cleanup_result"),
    // 예약원격 창(마이그 048) — 거래처가 승인한 "수락 없이 들어와도 되는" 구간의 종료 시각.
    //   ★창의 진실은 거래처 PC 의 마커 파일이고 여기 값은 그 사본이다. 에이전트가 heartbeat
    //   마다 알려 주는 것을 담아 둘 뿐이라, 꺼진 PC 의 값은 마지막 보고 시점 그대로다.
    //   schedCloseRequestedAt = 대리점이 [강제 닫기]를 누른 시각(cleanup 과 같은 큐 방식).
    schedOpenUntil: timestamp("sched_open_until", { withTimezone: true }),
    schedCloseRequestedAt: timestamp("sched_close_requested_at", {
      withTimezone: true,
    }),
    // 방화벽 자동 해제 관제(마이그 028) — 메인/오더 POS 방화벽 원복 방지. 거래처별 on/off(기본 off).
    //   firewallControl=on 이면 에이전트가 로컬에서 방화벽을 감시하다 켜지면 즉시 해제 + 알림 끔.
    //   firewallEnabled = 에이전트 보고(현재 방화벽 켜짐?), disarmCount = 자동 해제 누적(잦으면 업뎃 잦음).
    firewallControl: boolean("firewall_control").notNull().default(false),
    firewallEnabled: boolean("firewall_enabled"),
    firewallDisarmCount: integer("firewall_disarm_count").notNull().default(0),
    firewallLastDisarmAt: timestamp("firewall_last_disarm_at", { withTimezone: true }),
    // VAN 카드결제 데몬 관제(마이그 036) — 거래처마다 VAN 사가 달라 on/off 가 아니라 종류를 담는다.
    //   vanWatch=null/빈값이면 관제 off(기본), 'ksnet' 이면 에이전트가 KSCAT 의 27015 를 감시하다
    //   닫히면 되살린다. vanOk=마지막 점검 결과, vanGaveUp=재실행으로 안 낫아 손 뗌(사람이 갈 일).
    vanWatch: text("van_watch"),
    vanOk: boolean("van_ok"),
    vanRestartCount: integer("van_restart_count").notNull().default(0),
    vanLastRestartAt: timestamp("van_last_restart_at", { withTimezone: true }),
    // 재시작의 성패(마이그051) — restart_count 는 "KSCAT 을 실행시킨 횟수"라 되살아났는지를
    //   말해 주지 않는다. 에이전트가 같은 heartbeat 에 실어 보내는 vanOk 가 grace 이후의
    //   판정이므로, 그 짝을 여기 나눠 센다. 둘의 합이 restart_count 보다 작으면 그 차이가
    //   "성패를 모르는 구간"(이 기능 이전 기록)이고, 화면은 그걸 실패로 읽지 않는다.
    vanRecoveredCount: integer("van_recovered_count").notNull().default(0),
    vanUnrecoveredCount: integer("van_unrecovered_count").notNull().default(0),
    vanGaveUp: boolean("van_gave_up").notNull().default(false),
    // 데몬이 그 기기에 아예 없음(마이그037) — 다른 VAN 거래처에 관제를 잘못 켠 경우.
    //   vanGaveUp 과 함께 참이 되지만 조치가 정반대다: 이쪽은 관제만 끄면 끝난다.
    vanMissing: boolean("van_missing").notNull().default(false),
    // NAT 유형(마이그039) — 0=미상 1=Cone(홀펀칭 가능) 2=Symmetric(릴레이 불가피).
    //   NULL=구버전 에이전트. 릴레이 원인을 짐작 대신 세기 위한 값이다.
    natType: integer("nat_type"),
    // 공유기 UPnP 지원(마이그040) — 'no'|'found'|'yes'. NULL=구버전/측정 전.
    //   NAT 유형이 Cone 이라도 실제로는 안 뚫리는 곳이 있어(테스트1), 직결을 되살릴 다른
    //   길이 있는지 세는 값이다. 조사는 읽기 전용이라 포트를 열지 않는다.
    upnp: text("upnp"),
    // 거래처별 포트 열기 스위치(마이그041). ★기본 꺼짐 — 열면 그 POS 가 인터넷에서
    //   도달 가능해지므로 골라서 켠다(방화벽·VAN 관제와 같은 방식).
    upnpEnabled: boolean("upnp_enabled").notNull().default(false),
    // 공유기가 열어 준 바깥 주소 "ip:port". 본사 앱이 연결 후보로 쓴다.
    //   ★검증(마이그042)을 통과한 것만 본사 앱에 내려간다 — 공유기가 매핑을 등록해 놓고도
    //   실제로는 안 넘기는 경우가 있어(우리집 실측) 공유기 말만 믿으면 죽은 주소를 후보로
    //   잡는다. 판정은 upnpVerifiedAt 이 하고, 여기 값은 날것 그대로 둔다.
    upnpEndpoint: text("upnp_endpoint"),
    // 문 검증(마이그042) — 클라우드가 바깥에서 그 주소를 두드려 에이전트 인사까지 받은 시각.
    //   probe 는 시도 시각(성공·실패 무관)이라 "아직 확인 못 함"과 "닫혀 있음"이 갈린다.
    upnpVerifiedAt: timestamp("upnp_verified_at", { withTimezone: true }),
    upnpProbeAt: timestamp("upnp_probe_at", { withTimezone: true }),
    // 연결 경로 점검(마이그043) — HQ 가 한 바퀴 돌며 연결만 해 보고 끊은 결과.
    //   true=직결 / false=서버 경유 / NULL=측정 전이거나 연결 실패. 비율이 아니라 **명단**이
    //   목적이다(어느 집이 릴레이만 타는가). 지원기록과는 별개 — 그쪽은 내부 기기를 빼지만
    //   여기는 우리 장비도 포함해서 다 잰다.
    probeDirect: boolean("probe_direct"),
    probeAt: timestamp("probe_at", { withTimezone: true }),
    probeMs: integer("probe_ms"),
    // 내부 기기(본사/Mac/빌드머신 — 진짜 거래처 아님, 마이그 013). true 면 일괄푸시에서 빼고
    // UI 에서 버전/푸시 숨김. pin_order = 표 상단 고정 순서(1=최상단, NULL=일반 거래처).
    isInternal: boolean("is_internal").notNull().default(false),
    pinOrder: integer("pin_order"),
    // 폴더(마이그 026) — 같은 매장 여러 POS 를 묶는 수동 그룹. NULL=폴더 없음.
    //   운영자가 폴더를 만들고 배정(이름 접두 자동그룹핑 아님). 폴더 삭제 시 SET NULL.
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
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

// 거래처 폴더(마이그 026) — 같은 매장 여러 POS 를 묶는 수동 그룹. 운영자가 폴더를 만들고
// 거래처를 직접 배정한다(이름 접두 자동그룹핑 아님 — 엉뚱한 묶임 방지). tenant 내 이름 유일.
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantNameIdx: uniqueIndex("uq_folders_tenant_name").on(t.tenantId, t.name),
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
    // HQ 기록 확장(마이그022) — 전부 선택적(빈칸/미기록 허용).
    //   contactName: 거래처측 응대자(분쟁 근거). categories: A/S 종류 멀티(콤마 조인, 예 "printer,payment").
    contactName: text("contact_name"),
    categories: text("categories"),
    // 이 세션이 직결(P2P)이었나 릴레이였나(마이그038). NULL=미보고(구버전 HQ).
    //   릴레이는 화면·파일이 전부 우리 서버를 거쳐 트래픽 비용이 된다 — 이 값이 쌓여야
    //   홀펀치 개선이 실제로 몇 %를 회수했는지 증명할 수 있다.
    connDirect: boolean("conn_direct"),
    // 예약 원격 창으로 **수락 없이** 들어간 접속인가(마이그049). 기본 false.
    //   ★출처는 거래처다. 본사가 "그때 창이 열려 있었으니" 로 추측하면 재시작 grace 통과와
    //   구분이 안 된다 — 통과 판정을 한 쪽만 사실을 안다. 영구 비밀번호와 이 기능을 가르는
    //   근거 중 "기록이 남는다" 를 실제로 채우는 값이다.
    viaSchedWindow: boolean("via_sched_window").notNull().default(false),
    // 폐기 표식(마이그045). 패널 [기록 폐기]는 행을 지우지 않고 이 시각만 박는다 — 15초 이상
    //   원격한 사실은 분쟁 근거라 반드시 남는다. 기본 조회에선 숨기고 "폐기 포함"으로만 보인다.
    //   HQ 의 15초 미만 오접속 자동 폐기는 여전히 DELETE(규칙: 15초 미만은 기록 안 남김).
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    // 수동 기록(마이그045) — 원격 없이 사람이 손으로 남긴 행(전화 처리, 지워진 기록 복원).
    manual: boolean("manual").notNull().default(false),
    // 접속 기기 스탬프(마이그046) — 세션을 시작한 HQ 의 호스트명·IP. 좌석(active_login_sessions)
    //   에 이미 있는 값을 시작 시점에 복사한 것(그쪽은 계정당 한 줄이라 덮어써진다).
    //   ★정황이지 증거가 아니다: 호스트명은 사용자가 바꿀 수 있고 IP 는 공유기 단위다.
    operatorDevice: text("operator_device"),
    operatorIp: text("operator_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    startedIdx: index("idx_sessions_tenant_started").on(t.tenantId, t.startedAt),
    customerStartedIdx: index("idx_support_sessions_customer_started").on(
      t.tenantId,
      t.customerId,
      t.startedAt,
    ),
  }),
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

// 거래처 알림 — enroll "상호 = 교체 키" 매트릭스(2026-07-14)의 사람 결정 큐 + 자동 액션 감사 로그.
//   미해결(resolved_at IS NULL)만 배지로 노출. 매칭/신원 키 아님.
export const customerAlerts = pgTable(
  "customer_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    // reinstalled_new_name | same_name_new_device | device_replaced | device_moved
    type: text("type").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({
    tenantOpenIdx: index("idx_customer_alerts_tenant_open").on(t.tenantId, t.createdAt),
  }),
);

// 대리점 문의함 — 건의·버그 신고 (마이그 031, 2026-08-07).
//   게시판이 아니라 문의함이다: 대리점은 자기가 낸 것만 보고, 전체를 보는 건 super_admin
//   뿐이다. 목록 조회가 tenant_id 로 잘려 격리가 공짜로 따라온다. 게시판으로 키우려면
//   나중에 공개 플래그를 더하면 되지만, 반대 방향은 이미 쓰인 글의 노출 범위를 바꿔야 해서
//   훨씬 비싸다.
export const feedback = pgTable(
  "feedback",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    // 낸 사람이 퇴사해 계정이 지워져도 문의는 남는다 — 누가 냈는지보다 무엇을 요청했는지가
    //   우리에게 남아야 할 정보다. 이름은 아래 authorName 스냅샷으로 살린다.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    // bug | suggestion
    kind: text("kind").notNull().default("suggestion"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // open | reviewing | done | declined — super_admin 만 바꾼다.
    status: text("status").notNull().default("open"),
    reply: text("reply"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    // 첨부가 있었는지. 90일 정리로 파일이 사라져도 "있었음"을 화면에 표시하려고 남긴다.
    hadImages: boolean("had_images").notNull().default(false),
    // 대리점이 답변을 확인한 시각(마이그 034). replied_at 보다 이르거나 없으면 "새 답변".
    replySeenAt: timestamp("reply_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index("idx_feedback_tenant_created").on(t.tenantId, t.createdAt),
    statusCreatedIdx: index("idx_feedback_status_created").on(t.status, t.createdAt),
  }),
);

// 문의 첨부 이미지 (마이그 032). 파일은 디스크(bind mount), 여기엔 경로·메타만.
//   ★서빙은 반드시 인증 라우트로 — 공개 정적 경로에 두면 URL 만 알면 남의 대리점
//   스크린샷이 열린다. POS 화면에는 매출·고객정보가 찍혀 있을 수 있다.
export const feedbackImages = pgTable(
  "feedback_images",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // 마이그의 FK(ON DELETE CASCADE)가 실제 제약이다. drizzle 쪽은 타입만 맞춘다.
    feedbackId: bigint("feedback_id", { mode: "number" }).notNull(),
    // 서빙 라우트가 조인 없이 격리를 확인하려는 중복 보관.
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    storedName: text("stored_name").notNull().unique(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    feedbackIdx: index("idx_feedback_images_feedback").on(t.feedbackId),
    createdIdx: index("idx_feedback_images_created").on(t.createdAt),
  }),
);

// 릴리즈 노트(체인지로그) — 마이그 035. release-full.sh 가 발행 직후 자동 기록한다.
//   사람이 "발행하고 나서 적기"를 기억해야 하는 구조면 반드시 빠진다.
export const releases = pgTable(
  "releases",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // agent(거래처) | hq(본사 앱) | chaingo(무설치)
    kind: text("kind").notNull(),
    version: text("version").notNull(),
    // 대리점이 읽을 문장. 커밋 메시지를 그대로 옮기지 않는다.
    notes: text("notes"),
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    releasedIdx: index("idx_releases_released").on(t.releasedAt),
  }),
);

// 본사 앱 → 관리 패널 한 번 열기 티켓(마이그050).
//   ★60초 만료 + 소비 즉시 DELETE. 주소에 실려 방문기록·Referer 로 샐 수 있는 값이라
//   재사용 창을 최대한 좁힌다 — 서명 토큰만으로는 '한 번만' 을 보장할 수 없다.
//   저장은 해시(heartbeat 토큰과 같은 규칙) — DB 가 새도 티켓 자체는 못 쓴다.
export const panelTickets = pgTable("panel_tickets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
