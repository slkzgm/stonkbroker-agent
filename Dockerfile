FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY src ./src
RUN pnpm run build && pnpm prune --prod --ignore-scripts

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    OUTBOX_PATH=/data/outbox.json
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir /data && chown node:node /data
USER node
ENTRYPOINT ["node", "/app/dist/src/server.js"]
