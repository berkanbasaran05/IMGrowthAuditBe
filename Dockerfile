# IM Growth Audit — backend (NestJS). Node 22 gerekir (process.loadEnvFile, AbortSignal.any).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npx nest build

# Migration hedefi: Prisma CLI geliştirme bağımlılığı olduğu için ayrı imajda çalışır (docker compose "migrate" servisi).
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM build AS prune
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production BACKEND_HOST=0.0.0.0 BACKEND_PORT=3001 TRUST_PROXY_HOPS=1
COPY --from=prune /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY --from=build /app/package.json ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "dist/main.js"]
