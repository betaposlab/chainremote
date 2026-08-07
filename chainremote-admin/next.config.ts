import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NAS Docker 컨테이너용 — 의존성 트레이싱 후 .next/standalone 폴더에 minimal 빌드 결과 생성.
  // 공식 가이드: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
  output: "standalone",
  // dev mode 의 좌측 하단 라우트 인디케이터가 사이드바 로그아웃과 겹침 → 우측 하단으로 이동.
  // (production 빌드엔 어차피 안 뜸)
  devIndicators: { position: "bottom-right" },
  experimental: {
    serverActions: {
      // 문의 첨부는 5MB × 3장을 허용한다. 서버 액션 본문 기본 한도는 1MB 라, 이걸 안 올리면
      //   2MB 짜리 스크린샷 한 장에 "Body exceeded 1 MB limit" 로 죽는다(2026-08-07 실제 사고).
      //   multipart 경계·파트 헤더가 얹히므로 문서 권고대로 여유를 둔 16mb 로 잡았다.
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
