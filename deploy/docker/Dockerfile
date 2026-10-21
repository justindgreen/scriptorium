# syntax=docker/dockerfile:1.7
# Scriptorium application image: API server + built web app + bundled content + CLI.
# Build from the repository root:  docker build -f deploy/docker/Dockerfile -t scriptorium .

FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/content-schema/package.json packages/content-schema/
COPY packages/dice/package.json packages/dice/
COPY packages/rules-engine/package.json packages/rules-engine/
COPY tools/spikes/package.json tools/spikes/
COPY tools/srd-import/package.json tools/srd-import/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @scriptorium/web build && pnpm --filter @scriptorium/server build
# Production node_modules for the server only (bundled workspace packages need no copies).
RUN pnpm --filter @scriptorium/server deploy --prod --legacy /out/server

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    CONTENT_DIR=/app/content \
    WEB_DIST_DIR=/app/web
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out/server/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
COPY --from=build /repo/apps/web/dist ./web
COPY --from=build /repo/content ./content
COPY deploy/docker/entrypoint.sh /usr/local/bin/scriptorium
RUN chmod +x /usr/local/bin/scriptorium && mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]
