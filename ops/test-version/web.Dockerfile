FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
WORKDIR /app
ARG WEB_ROOT
ARG RELEASE_SHA=unknown
ENV NODE_ENV=production PORT=8080
LABEL org.opencontainers.image.title="CarePoint Flutter Web Test Client" \
      org.opencontainers.image.revision="$RELEASE_SHA"
COPY --chown=node:node ops/test-version/static-server.mjs /app/server.mjs
COPY --chown=node:node ${WEB_ROOT}/ /app/public/
USER node
EXPOSE 8080
CMD ["node", "/app/server.mjs"]
