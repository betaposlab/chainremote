"use client";

// 대시보드 카드 — owner 가 자기 회사 전용 거래처 에이전트(.exe)를 직접 받는다.
// POST /api/tenants/[id]/agent 가 owner-자기테넌트를 허용하고, 키가 안정적이라 다시 받아도
// 같은 .exe. super_admin 에게도 보이지만 보통은 '회사 관리'에서 대리점별로 받는다.

import { useState } from "react";

export function AgentDownloadCard({
  tenantId,
  displayName,
}: {
  tenantId: string;
  displayName: string;
}) {
  const [downloading, setDownloading] = useState(false);

  async function doDownload() {
    if (
      !confirm(
        `'${displayName}' 가맹점에 설치할 원격지원 에이전트(.exe)를 다운로드합니다.\n\n` +
          `이 파일을 가맹점 PC 에 설치하면 자동으로 우리 회사 거래처로 등록됩니다.\n` +
          `(여러 번 받아도 같은 파일입니다.)`,
      )
    )
      return;
    setDownloading(true);
    try {
      const resp = await fetch(`/api/tenants/${tenantId}/agent`, {
        method: "POST",
      });
      if (!resp.ok) {
        let msg = "다운로드 실패";
        try {
          const j = await resp.json();
          msg = j.error ?? msg;
        } catch {}
        throw new Error(msg);
      }
      const blob = await resp.blob();
      const safe =
        (displayName.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim() ||
          tenantId).slice(0, 50);
      // 라우트가 X-Agent-Version 헤더로 베이스 버전을 주면 파일명에 붙인다.
      const ver = resp.headers.get("X-Agent-Version");
      const verSuffix = ver ? `_v${ver}` : "";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ChainRemote_${safe}_가맹점설치용${verSuffix}.exe`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.message ?? "다운로드 실패");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="panel-card-spotlight mb-8 px-5 py-4">
      <h2 className="text-base font-semibold text-white">설치파일</h2>

      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-sm text-[#eef1f7]">
          <span className="font-medium text-white">가맹점(거래처)용</span> —
          가맹점 PC 에 설치할 우리 회사 전용 원격지원 에이전트입니다. 설치하면
          자동으로 거래처 목록에 등록됩니다.
        </p>
        <button type="button" onClick={doDownload} disabled={downloading} className="btn btn-primary shrink-0">
          {downloading ? "준비 중..." : "에이전트 다운로드"}
        </button>
      </div>

      {/* HQ 는 오버레이가 없어 링크 한 줄이면 된다 — 라우트가 latest.json 을 보고 최신으로
          넘긴다(버전을 여기 박으면 릴리즈 때마다 손봐야 하고, 빠뜨리면 굳는다). */}
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-[#56699c] pt-4">
        <p className="text-sm text-[#eef1f7]">
          <span className="font-medium text-white">본사 직원용 (HQ)</span> —
          직원 PC 에 설치하는 원격지원 앱입니다. 설치 후 본인 계정으로 로그인하면
          우리 회사 거래처가 보입니다. 항상 최신 버전이 받아집니다.
        </p>
        <a href={`/api/tenants/${tenantId}/hq`} className="btn btn-ghost shrink-0">
          HQ 다운로드
        </a>
      </div>
    </section>
  );
}
