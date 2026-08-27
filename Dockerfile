# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build ----
FROM node:22-slim AS build
# Toolchain for native modules (better-sqlite3 compiles from source when no
# prebuilt binary matches the platform).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY frontend/package.json frontend/
# The mobile workspace is declared in the root manifest, so npm needs its
# package.json to parse the tree — but we never install or build it here.
COPY mobile/package.json mobile/
RUN npm ci --workspace server --workspace frontend --include-workspace-root
COPY server server
COPY frontend frontend
RUN npm run build --workspace server && npm run build --workspace frontend

# --------------------------------------------------- production deps ----
FROM node:22-slim AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY mobile/package.json mobile/
COPY frontend/package.json frontend/
RUN npm ci --workspace server --omit=dev \
    # Guarantee the dir exists so the COPY below never fails (npm hoists
    # most workspace deps to the root node_modules).
    && mkdir -p server/node_modules

# -------------------------------------------------------------- runtime ----
FROM node:22-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DB_PATH=/data/language-globe.sqlite
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/frontend/dist frontend/dist
COPY server/package.json server/package.json
RUN mkdir -p /data server/tmp && chown -R node:node /data /app
USER node
EXPOSE 8787
VOLUME /data
CMD ["node", "server/dist/index.js"]
