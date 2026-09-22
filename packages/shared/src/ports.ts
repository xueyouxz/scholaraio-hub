export const DEFAULT_PORT = 3400;
export const DEFAULT_DEV_PORT = 3500;
export const DEFAULT_TEST_PORT = 3600;

export interface DerivedPorts {
  app: number;
  client: number;
  preview: number;
}

type PortEnv = Record<string, string | undefined>;

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    return fallback;
  }

  return parsed;
}

export function resolveBasePort(env: PortEnv = {}): number {
  const fallback =
    env.NODE_ENV === "test"
      ? DEFAULT_TEST_PORT
      : env.NODE_ENV === "development"
        ? DEFAULT_DEV_PORT
        : DEFAULT_PORT;
  return parsePort(env.PORT, fallback);
}

export function resolveDerivedPorts(env: PortEnv = {}): DerivedPorts {
  const app = resolveBasePort(env);

  return {
    app,
    client: parsePort(env.CLIENT_PORT, app + 1),
    preview: parsePort(env.CLIENT_PREVIEW_PORT, app + 2),
  };
}
