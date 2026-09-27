export const DEFAULT_PORT = 3400;
export const DEFAULT_DEV_PORT = 3500;
export const DEFAULT_TEST_PORT = 3600;

type PortEnv = Record<string, string | undefined>;

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    return fallback;
  }

  return parsed;
}

/**
 * Which Hub instance this is. The profile picks the data directory and the
 * default port; `production` is the one users run, anything else is isolated
 * from it. Tests always get the test profile, whatever else is set, so a test
 * run can never touch real data or a running Hub's port.
 */
export function resolveProfileName(env: PortEnv = {}): string {
  if (env.NODE_ENV === "test") return "test";
  const explicit = env.SCHOLARAIO_HUB_PROFILE?.trim();
  if (explicit) return explicit;
  return env.NODE_ENV === "production" ? "production" : "dev";
}

/** The application's one port: page, API and, in development, Vite's HMR socket. */
export function resolvePort(env: PortEnv = {}): number {
  const profile = resolveProfileName(env);
  const fallback =
    profile === "production"
      ? DEFAULT_PORT
      : profile === "test"
        ? DEFAULT_TEST_PORT
        : DEFAULT_DEV_PORT;
  return parsePort(env.PORT, fallback);
}

/**
 * The page's `<meta>` naming the library service's port: the browser calls the
 * service directly, on the host it loaded the page from.
 */
export const LIBRARY_PORT_META = "scholaraio-library-port";

/**
 * The library service's port: `LIBRARY_PORT`, else the one after the Hub's,
 * so every profile's pair stays apart (3400/3401, 3500/3501, 3600/3601).
 */
export function resolveLibraryPort(env: PortEnv = {}): number {
  return parsePort(env.LIBRARY_PORT, resolvePort(env) + 1);
}
