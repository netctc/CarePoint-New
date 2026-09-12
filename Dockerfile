FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY services/api/package.json services/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/identity/package.json packages/identity/package.json
COPY packages/security/package.json packages/security/package.json
RUN npm ci

COPY . .
RUN npm run build --workspace @carepoint/contracts \
 && npm run build --workspace @carepoint/identity \
 && npm run build --workspace @carepoint/security \
 && npm run build --workspace @carepoint/api \
 && npm run build --workspace @carepoint/admin

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS api
WORKDIR /app
ENV NODE_ENV=production
ARG RELEASE_SHA=unknown
ARG RELEASE_VERSION=unversioned
LABEL org.opencontainers.image.title="CarePoint API" \
      org.opencontainers.image.revision="$RELEASE_SHA" \
      org.opencontainers.image.version="$RELEASE_VERSION"

COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/package.json ./package.json
COPY --from=build --chown=node:node /workspace/services/api/package.json ./services/api/package.json
COPY --from=build --chown=node:node /workspace/services/api/dist ./services/api/dist
COPY --from=build --chown=node:node /workspace/services/api/prisma ./services/api/prisma
COPY --from=build --chown=node:node /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /workspace/packages/identity/package.json ./packages/identity/package.json
COPY --from=build --chown=node:node /workspace/packages/identity/dist ./packages/identity/dist
COPY --from=build --chown=node:node /workspace/packages/security/package.json ./packages/security/package.json
COPY --from=build --chown=node:node /workspace/packages/security/dist ./packages/security/dist

USER node
WORKDIR /app/services/api
EXPOSE 4000
CMD ["node", "dist/main.js"]

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS admin
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
ARG RELEASE_SHA=unknown
ARG RELEASE_VERSION=unversioned
LABEL org.opencontainers.image.title="CarePoint Admin" \
      org.opencontainers.image.revision="$RELEASE_SHA" \
      org.opencontainers.image.version="$RELEASE_VERSION"

COPY --from=build --chown=node:node /workspace/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/admin/.next/static ./apps/admin/.next/static

USER node
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
