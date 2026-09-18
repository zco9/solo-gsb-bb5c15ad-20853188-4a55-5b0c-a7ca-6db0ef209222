FROM node:20-alpine

WORKDIR /app

# 先单独拷贝依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 拷贝应用代码
COPY server.js imposition.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "server.js"]
