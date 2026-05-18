import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NAS Docker 컨테이너용 — 의존성 트레이싱 후 .next/standalone 폴더에 minimal 빌드 결과 생성.
  // 공식 가이드: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
  output: "standalone",
  // dev mode 의 좌측 하단 라우트 인디케이터가 사이드바 로그아웃과 겹침 → 우측 하단으로 이동.
  // (production 빌드엔 어차피 안 뜸)
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
