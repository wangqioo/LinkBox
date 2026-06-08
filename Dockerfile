# syntax=docker/dockerfile:1

FROM node:20-slim AS client-builder
WORKDIR /app/client
RUN npm config set registry https://registry.npmmirror.com
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-slim AS mobile-builder
WORKDIR /app/mobile
RUN npm config set registry https://registry.npmmirror.com
COPY mobile/package*.json ./
RUN npm ci
COPY mobile/ ./
RUN npm run build

FROM node:20-slim AS server-deps
WORKDIR /app/server
RUN set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's/deb.debian.org/mirrors.aliyun.com/g; s/security.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends python3 make g++ ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    npm config set registry https://registry.npmmirror.com
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3100 \
    DATA_DIR=/data \
    UPLOADS_DIR=/data/uploads \
    DB_PATH=/data/linkbox.db \
    LOCAL_LLM_URL=http://127.0.0.1:8000/v1 \
    LOCAL_LLM_MODEL=Qwen3.5-4B \
    LOCAL_VISION_MODEL=Qwen3.5-4B \
    TZ=Asia/Shanghai

RUN set -eux; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's/deb.debian.org/mirrors.aliyun.com/g; s/security.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates unzip poppler-utils; \
    rm -rf /var/lib/apt/lists/*

COPY server/ ./server/
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=client-builder /app/client/dist ./client/dist
COPY --from=mobile-builder /app/mobile/dist ./mobile/dist

RUN mkdir -p /data/uploads
VOLUME ["/data"]
EXPOSE 3100
CMD ["node", "server/index.js"]
