import * as path from "node:path";
import pino from "pino";

export type LogLevel = pino.LevelWithSilent;

export interface LogConfig {
  /** Directory for log files; required when `logToFile` is set. */
  logDir: string;
  logFile: string;
  /** Minimum log level for the console. */
  consoleLevel: LogLevel;
  /** Minimum log level for the file. */
  fileLevel: LogLevel;
  logToFile: boolean;
  /** Human-readable console output instead of JSON lines. */
  prettyPrint: boolean;
}

/**
 * For code that logs before, or without, the server's `initLogger(config)`:
 * tests and `pnpm hub` commands. The server passes its own configuration.
 */
const CONSOLE_ONLY: LogConfig = {
  logDir: "",
  logFile: "server.log",
  consoleLevel: "info",
  fileLevel: "info",
  logToFile: false,
  prettyPrint: true,
};

/** How much one log file may hold, and how many rotated files are kept. */
const LOG_ROTATION = { size: "10m", frequency: "daily", limit: { count: 7 } } as const;

/**
 * What every logger shares. Errors are serialized under either key (pino alone
 * turns an Error under `error` into `{}`), and credentials never reach a log.
 */
const LOGGER_OPTIONS: pino.LoggerOptions = {
  serializers: { err: pino.stdSerializers.err, error: pino.stdSerializers.err },
  redact: {
    paths: [
      "authorization",
      "*.authorization",
      "headers.authorization",
      "cookie",
      "*.cookie",
      "headers.cookie",
      "password",
      "*.password",
      "token",
      "*.token",
      "accessToken",
      "*.accessToken",
      "refreshToken",
      "*.refreshToken",
      "apiKey",
      "*.apiKey",
    ],
    censor: "[redacted]",
  },
};

let root: pino.Logger | undefined;
const children = new Map<string, pino.Logger>();

function transportFor(config: LogConfig): pino.DestinationStream {
  const targets: pino.TransportTargetOptions[] = [
    config.prettyPrint
      ? {
          target: "pino-pretty",
          level: config.consoleLevel,
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname,console",
          },
        }
      : { target: "pino/file", level: config.consoleLevel, options: { destination: 1 } },
  ];
  if (config.logToFile)
    targets.push({
      target: "pino-roll",
      level: config.fileLevel,
      // Logs hold prompts and paths: readable by this user only.
      options: {
        file: path.join(config.logDir, config.logFile),
        mkdir: true,
        mode: 0o600,
        ...LOG_ROTATION,
      },
    });
  return pino.transport({ targets });
}

/**
 * Set up logging; the server calls this once at startup. Loggers obtained
 * earlier through `loggerFor` follow the new configuration. `destination`
 * replaces the configured outputs (tests).
 */
export function initLogger(
  config: Partial<LogConfig> = {},
  destination?: pino.DestinationStream,
): pino.Logger {
  const final = { ...CONSOLE_ONLY, ...config };
  // pino's own level must let through whatever the most verbose output wants.
  const rank = (level: LogLevel) => pino.levels.values[level] ?? Number.POSITIVE_INFINITY;
  const outputs = final.logToFile ? [final.consoleLevel, final.fileLevel] : [final.consoleLevel];
  const level = outputs.reduce((a, b) => (rank(a) <= rank(b) ? a : b));
  root = pino({ ...LOGGER_OPTIONS, level }, destination ?? transportFor(final));
  children.clear();
  return root;
}

/** The root logger; configured with the defaults when `initLogger` has not run. */
export function getLogger(): pino.Logger {
  return root ?? initLogger();
}

/**
 * The logger of one part of the server, tagged `component`. Call it where
 * you log rather than once at module load: modules load before the server
 * configures logging, and this always answers with the current configuration.
 */
export function loggerFor(component: string): pino.Logger {
  let child = children.get(component);
  if (!child) {
    child = getLogger().child({ component });
    children.set(component, child);
  }
  return child;
}

/**
 * Route console output through the logger, so third-party code that prints
 * (SDKs, Vite) lands in the same outputs. The Hub's own code uses `loggerFor`.
 */
export function interceptConsole(): void {
  const write =
    (level: "info" | "warn" | "error" | "debug") =>
    (...args: unknown[]) =>
      getLogger()[level]({ console: true }, formatConsoleArgs(args));
  console.log = write("info");
  console.info = write("info");
  console.warn = write("warn");
  console.error = write("error");
  console.debug = write("debug");
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.stack || arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}
