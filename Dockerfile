FROM ghcr.io/astral-sh/uv:0.9.11 AS uv

FROM node:22-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
COPY --from=uv /uv /uvx /usr/local/bin/
ENV COREPACK_HOME=/opt/corepack \
    NODE_USE_ENV_PROXY=1
WORKDIR /app

FROM base AS build
COPY . .
ENV HUSKY=0
RUN corepack install && pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3400 \
    LIBRARY_PORT=3401 \
    SCHOLARAIO_HUB_PROFILE=production \
    SCHOLARAIO_HUB_DATA_DIR=/home/node/.scholaraio-hub \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1
COPY --from=build --chown=node:node /app /app
COPY --from=build /opt/corepack /opt/corepack
RUN chmod +x /app/docker/entrypoint.sh
USER node
# Docker initializes a new home volume with this prepared, cached Python runtime.
RUN pnpm hub setup --production
EXPOSE 3400 3401
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "scripts/hub.mjs", "start"]
