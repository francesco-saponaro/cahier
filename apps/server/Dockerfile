FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm --filter @cahier/domain --filter @cahier/db --filter @cahier/server build

FROM node:22-alpine
WORKDIR /repo
COPY --from=build /repo ./
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/server/dist/server.js"]
