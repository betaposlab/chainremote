"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/data/audit";
import { redirect } from "next/navigation";
import { requireLiveUserOrThrow } from "@/lib/auth-guard";
import * as data from "@/lib/data/customers";
import * as favData from "@/lib/data/favorites";
import { listTenantStaff } from "@/lib/data/users";
import { createFolder } from "@/lib/data/folders";
import { canWrite } from "@/lib/roles";

async function requireSession() {
  // 쿠키의 존재가 아니라 **계정이 지금도 살아 있는지**를 본다(퇴사자 즉시 차단).
  return requireLiveUserOrThrow();
}

// 폼의 folderName(자유 입력)을 folderId 로 푼다 — 같은 이름이 있으면 그 폴더, 없으면 새로
//   만든다(findOrCreate). 빈값이면 null(폴더 해제). createFolder 가 tenantId 로 만들어
//   자기 대리점 폴더만 생기므로 cross-tenant 걱정이 없다.
async function resolveFolderId(
  formData: FormData,
  tenantId: string,
): Promise<string | null> {
  const raw = formData.get("folderName");
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return null;
  const folder = await createFolder(tenantId, name);
  return folder.id;
}

// 담당 배정 검증 — assignedUserId 가 이 테넌트 소속 직원일 때만 통과(타테넌트 배정 차단).
// 빈값/미소속이면 null(미배정).
async function sanitizeAssignee(
  assignedUserId: string | null | undefined,
  tenantId: string,
): Promise<string | null> {
  if (!assignedUserId) return null;
  const staff = await listTenantStaff(tenantId);
  return staff.some((s) => s.id === assignedUserId) ? assignedUserId : null;
}

function pickFields(formData: FormData): data.CustomerFields {
  const get = (k: string) => {
    const v = formData.get(k);
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed === "" ? null : trimmed;
  };
  const name = get("name");
  if (!name) throw new Error("상호는 필수입니다");
  // 원격 ID 정규화 — 공백 제거 + 대문자화. 매칭은 대소문자 구분 eq 라
  // 에이전트 저장값(대문자·공백없음)과 정확히 일치해야 한다. 신형 AB ID·구형 숫자 공통.
  const rawRemoteId = get("remoteId");
  const remoteId = rawRemoteId ? rawRemoteId.replace(/\s+/g, "").toUpperCase() : null;
  return {
    name,
    contactName: get("contactName"),
    phone: get("phone"),
    address: get("address"),
    remoteId,
    accessPassword: get("accessPassword"),
    notes: get("notes"),
    assignedUserId: get("assignedUserId"),
  };
}

export async function createCustomer(formData: FormData) {
  const session = await requireSession();
  const fields = pickFields(formData);
  fields.assignedUserId = await sanitizeAssignee(fields.assignedUserId, session.tenantId);
  fields.folderId = await resolveFolderId(formData, session.tenantId);
  // 담당 미선택 시 생성자로 폴백(폴백 처리는 data.createCustomer 안).
  await data.createCustomer(fields, {
    tenantId: session.tenantId,
    assignedUserId: session.id,
  });
  revalidatePath("/customers");
  redirect("/customers");
}

export async function updateCustomer(id: string, formData: FormData) {
  const session = await requireSession();
  const fields = pickFields(formData);
  fields.assignedUserId = await sanitizeAssignee(fields.assignedUserId, session.tenantId);
  fields.folderId = await resolveFolderId(formData, session.tenantId);
  await data.updateCustomer(id, fields, { tenantId: session.tenantId });
  revalidatePath("/customers");
  redirect("/customers");
}

export async function deleteCustomer(id: string) {
  const session = await requireSession();
  // 지우기 전에 상호·ID 를 확보한다 — 지운 뒤엔 남는 게 uuid 뿐이라 나중에 봐도 모른다.
  const target = await data.getCustomer(id, session.tenantId);
  const ok = await data.deleteCustomer(id, { tenantId: session.tenantId });
  if (ok) {
    await writeAudit({
      action: "customer.delete",
      tenantId: session.tenantId,
      userId: session.id,
      targetType: "customer",
      targetId: id,
      metadata: { name: target?.name ?? null, remoteId: target?.remoteId ?? null },
    });
  }
  revalidatePath("/customers");
}

export async function importPeer(input: {
  remoteId: string;
  hostname?: string;
  username?: string;
  platform?: string;
  name?: string;
}) {
  const session = await requireSession();
  await data.importPeer(input, {
    tenantId: session.tenantId,
    assignedUserId: session.id,
  });
  revalidatePath("/customers");
}

// 자가등록 후보 거래처 확정 — enroll_status 'pending'→'active'. HQ 가 패널서 '확인' 클릭.
export async function confirmEnrollment(id: string) {
  const session = await requireSession();
  await data.confirmEnrollment(id, { tenantId: session.tenantId });
  revalidatePath("/customers");
}

// "신규 거래처 후보"(orphan 즐겨찾기) 무시 — 그 remote_id 의 미등록 즐겨찾기를 테넌트서 제거.
// 테스트 머신처럼 등록 안 할 후보를 배너에서 치울 때.
export async function dismissCandidate(remoteId: string) {
  const session = await requireSession();
  await favData.dismissOrphanCandidate(session.tenantId, remoteId);
  revalidatePath("/customers");
}

// [강제 닫기] — 열려 있는 예약원격 창을 닫으라고 큐잉. 원격 접근 권한을 **줄이는** 쪽이라
// 정리 명령과 같은 등급으로 둔다(viewer 만 제외). 거래처가 승인한 창을 대리점이 거두는
// 것이라 사장님께 다시 묻지 않는다 — 여는 쪽만 사장님 손이 필요하다.
export async function requestSchedCloseAction(remoteId: string): Promise<boolean> {
  const session = await requireSession();
  if (session.role === "viewer") throw new Error("권한 없음");
  const ok = await data.requestSchedClose(remoteId, { tenantId: session.tenantId });
  revalidatePath("/customers");
  return ok;
}

// [디스크 정리] — Temp+휴지통 원격 정리 명령 큐잉. 원격 지원에 준하는 행위라 viewer 만 제외.
// 에이전트가 다음 heartbeat(≤10분)에 받아 실행하고 결과를 보고한다.
export async function requestCleanupAction(remoteId: string): Promise<boolean> {
  const session = await requireSession();
  if (session.role === "viewer") throw new Error("권한 없음");
  const ok = await data.requestCleanup(remoteId, { tenantId: session.tenantId });
  revalidatePath("/customers");
  return ok;
}

/** 무인접속 비밀번호 저장 — 거래처 PC 가 이 값으로 수락 카드 없이 열린다.
 *
 *  ★일반 거래처 폼(pickFields)을 태우지 않고 따로 둔 이유: 그 경로는 폼에 있는 값을
 *    전부 그대로 받아 넘긴다. 문을 여는 값이 그 흐름에 섞이면, 나중에 폼에 칸 하나가
 *    늘거나 이름이 겹치는 날 조용히 같이 흘러간다. 문을 여는 값은 문을 여는 함수로만.
 *
 *  권한은 canWrite — 방화벽·디스크·푸시와 같은 축이다. 직원이 새로 얻는 능력이 없기
 *  때문이다: 이미 원격으로 들어가 거래처 PC 앞에서 손으로 정할 수 있는 값이고, 이건
 *  그 일을 사람 없이 할 수 있게 한 것뿐이다. 계정 비밀번호(canManageAccounts)와는 다르다.
 *
 *  대리점 무인접속 플래그는 **data 층에서 다시 본다**(setUnattendedPassword). */
export async function setUnattendedPasswordAction(
  customerId: string,
  password: string,
): Promise<{ ok: boolean; reason?: string }> {
  const session = await requireSession();
  if (!canWrite(session.role)) return { ok: false, reason: "권한이 없습니다" };

  const pw = password.trim();
  // 길이 상한은 저장이 아니라 **에이전트**를 위한 것이다. 하트비트 응답에 실려 나가고
  //   거래처 config 에 들어가는 값이라, 실수로 붙여넣은 문서 한 장이 흘러가지 않게 막는다.
  if (pw.length > 64) return { ok: false, reason: "64자를 넘길 수 없습니다" };
  // 하한 4자. 짧게 잡은 근거는 **에이전트에 대입 방어가 있다**는 것 하나다 —
  //   server/connection.rs 의 LOGIN_FAILURES 가 IP 당 분당 6회, 누적 30회에서 끊고
  //   IPv6 는 /56·/48 프리픽스로 묶어 센다. 4자리 숫자 1만 조합을 훑으려면 IP 를 300개
  //   넘게 갈아야 하고 그 전에 원격 ID 를 알아야 한다.
  //   ★그 방어가 사라지거나 약해지면 이 하한도 같이 올려야 한다. 두 값은 한 쌍이다.
  //   (2026-09-05 Chang: 달인식자재는 0547 로 쓴다. 포스 앞에서 불러 줄 번호라 길면 못 쓴다.)
  if (pw !== "" && pw.length < 4) return { ok: false, reason: "4자 이상이어야 합니다" };
  // 공백·줄바꿈은 에이전트가 그대로 비교하므로 눈에 안 보이는 불일치가 된다.
  if (/\s/.test(pw)) return { ok: false, reason: "공백은 넣을 수 없습니다" };

  const r = await data.setUnattendedPassword(customerId, session.tenantId, pw);
  if (!r.ok) return r;

  // ★값은 남기지 않는다. 누가 언제 어느 거래처의 문을 열고 닫았는지만 남는다.
  await writeAudit({
    action: pw === "" ? "customer.unattended_password_clear" : "customer.unattended_password_set",
    tenantId: session.tenantId,
    userId: session.id,
    targetType: "customer",
    targetId: customerId,
    metadata: { customerName: r.name },
  });

  revalidatePath("/customers");
  return { ok: true };
}
