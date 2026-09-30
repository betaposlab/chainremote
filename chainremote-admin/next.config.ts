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
  // 로그인 화면(626.kr 첫 화면)에서 브라우저에 Client Hints 를 청한다(2026-09-30). [원격지원 받기]를
  //   누른 요청에 비트수·Windows 버전이 실려 와야 32/64비트 판을 맞게 고른다 — User-Agent 는 크롬이
  //   모든 Windows 를 "NT 10.0; Win64" 로 고정해 보내서 못 믿는다(테스트1 실측). 라우트 쪽의
  //   Critical-CH 가 두 번째 안전망이다(lib/quick-support.ts).
  async headers() {
    const ch = "Sec-CH-UA-Platform, Sec-CH-UA-Bitness, Sec-CH-UA-Platform-Version";
    return [{ source: "/login", headers: [{ key: "Accept-CH", value: ch }] }];
  },
};

export default nextConfig;
