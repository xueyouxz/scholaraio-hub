FROM node:20-alpine AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json biome.json ./
COPY packages/client/package.json  ./packages/client/package.json
COPY packages/server/package.json  ./packages/server/package.json
COPY packages/shared/package.json  ./packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

FROM node:20-alpine AS runtime

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV HOST=0.0.0.0
ENV PORT=3400
ENV NODE_ENV=production

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json  ./packages/server/
COPY packages/shared/package.json  ./packages/shared/

# --ignore-scripts: the runtime only needs the prebuilt dist, and the root
# `prepare` script runs husky (a devDependency, absent in a --prod install),
# which would otherwise fail the install with "husky: not found".
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=builder /app/packages/server/dist  ./packages/server/dist
COPY --from=builder /app/packages/shared/dist  ./packages/shared/dist
COPY --from=builder /app/packages/client/dist  ./packages/client/dist

EXPOSE 3400

CMD ["pnpm", "--filter", "@scholaraio-hub/server", "start"]
