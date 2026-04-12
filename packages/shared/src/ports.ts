export const DEFAULT_PORT = 3400;

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
  return parsePort(env.PORT, DEFAULT_PORT);
}

export function resolveDerivedPorts(env: PortEnv = {}): DerivedPorts {
  const app = resolveBasePort(env);

  return {
    app,
    client: parsePort(env.CLIENT_PORT, app + 1),
    preview: parsePort(env.CLIENT_PREVIEW_PORT, app + 2),
  };
}
