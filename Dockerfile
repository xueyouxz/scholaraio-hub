FROM node:20-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json biome.json ./
COPY packages/client/package.json ./packages/client/package.json
COPY packages/server/package.json ./packages/server/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

EXPOSE 3400

CMD ["pnpm", "--filter", "@scholaraio-hub/server", "start"]
