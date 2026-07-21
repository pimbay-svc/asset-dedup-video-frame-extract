# --- deps stage (production-only node_modules for the runtime image) -----
FROM node:24-slim AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# --- build stage -----------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run js:build

# --- runtime stage -----------------------------------------------------------
FROM node:24-slim
WORKDIR /app

# ffmpeg package provides both `ffmpeg` and `ffprobe`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg gosu \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 1001 appuser

COPY --from=deps --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=build --chown=appuser:appuser /app/dist ./dist
COPY --chown=appuser:appuser package.json ./

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
ENV FFMPEG_BIN=ffmpeg
ENV FFPROBE_BIN=ffprobe

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=3s --retries=5 \
  CMD node dist/presentation/uds/healthcheck.js

CMD ["node", "dist/server.js"]
