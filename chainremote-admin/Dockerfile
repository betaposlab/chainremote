# ChainRemote 관리 패널 — NAS Container Manager 용 Dockerfile.
# 정석 패턴: Vercel 공식 Next.js Docker 예제
#   https://github.com/vercel/next.js/tree/canary/examples/with-docker
#
# Multi-stage build 로 최종 이미지 크기 최소화 (NAS 디스크 절약).
# Next.js standalone output 사용 → server.js 단일 진입점 + minimal node_modules.

# === Stage 1: 의존성 설치 ===
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# === Stage 2: Next.js 빌드 ===
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# === Stage 3: 런타임 (최종 이미지) ===
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# non-root 사용자 (보안 정석)
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# 매뉴얼 PDF. public/ 이 아니라 여기 두는 이유는 lib/manuals.ts 주석 참고 —
#   로그인한 사람만 /api/manuals/[slug] 를 통해 받아야 하는 문서가 섞여 있다.
COPY --from=builder /app/manuals ./manuals
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
