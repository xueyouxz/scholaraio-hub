import * as fs from "node:fs";
import * as path from "node:path";
import pino from "pino";

/**
 * Valid log levels.
 */
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogConfig {
  /** Directory for log files; required when `logToFile` is set. */
  logDir: string;
  logFile: string;
  /** Minimum log level for console. */
  consoleLevel: LogLevel;
  /** Minimum log level for the file. */
  fileLevel: LogLevel;
  logToFile: boolean;
  /** Use pretty printing for console. */
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

let logger: pino.Logger | null = null;
let originalConsole: {
  log: typeof console.log;
  error: typeof console.error;
  warn: typeof console.warn;
  info: typeof console.info;
  debug: typeof console.debug;
} | null = null;

/**
 * Initialize the logger with the given configuration.
 * This should be called once at server startup.
 */
export function initLogger(config: Partial<LogConfig> = {}): pino.Logger {
  const finalConfig = { ...CONSOLE_ONLY, ...config };
  let fileLoggingInitError: Error | null = null;

  const streams: pino.StreamEntry[] = [];

  // Console stream
  if (finalConfig.prettyPrint) {
    const pretty = pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname,console",
      },
    });
    streams.push({
      stream: pretty,
      level: finalConfig.consoleLevel as pino.Level,
    });
  } else {
    streams.push({
      stream: process.stdout,
      level: finalConfig.consoleLevel as pino.Level,
    });
  }

  // File stream
  if (finalConfig.logToFile) {
    try {
      fs.mkdirSync(finalConfig.logDir, { recursive: true });
      const logPath = path.join(finalConfig.logDir, finalConfig.logFile);
      const fileStream = fs.createWriteStream(logPath, { flags: "a" });
      fileStream.on("error", (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        process.stderr.write(`[logger] Failed to write log file ${logPath}: ${error.message}\n`);
      });
      streams.push({
        stream: fileStream,
        level: finalConfig.fileLevel as pino.Level,
      });
    } catch (err) {
      fileLoggingInitError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // Determine minimum level across all streams (pino needs base level <= stream levels)
  const minLevel = getMinLevel(finalConfig.consoleLevel, finalConfig.fileLevel);

  if (streams.length === 0) {
    // No streams configured, use a silent logger
    logger = pino({ level: "silent" });
  } else if (streams.length === 1 && streams[0]) {
    logger = pino({ level: streams[0].level }, streams[0].stream);
  } else {
    logger = pino({ level: minLevel }, pino.multistream(streams));
  }

  if (fileLoggingInitError) {
    logger.warn(
      { err: fileLoggingInitError, logDir: finalConfig.logDir },
      "Failed to initialize file logging; continuing with console-only logger",
    );
  }

  return logger;
}

/**
 * Get the minimum (most verbose) of two log levels.
 */
function getMinLevel(a: LogLevel, b: LogLevel): LogLevel {
  const order: Record<LogLevel, number> = {
    trace: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
    fatal: 5,
    silent: 6,
  };
  return order[a] <= order[b] ? a : b;
}

/**
 * Get the logger instance. Must call initLogger first.
 */
export function getLogger(): pino.Logger {
  if (!logger) {
    // Auto-initialize with defaults if not yet initialized
    return initLogger();
  }
  return logger;
}

/**
 * Intercept console.log/error/warn/info and route through pino logger.
 * Call this after initLogger() to capture all console output.
 */
export function interceptConsole(): void {
  if (originalConsole) {
    // Already intercepted
    return;
  }

  const log = getLogger();

  // Save original console methods
  originalConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

  // Replace console methods
  console.log = (...args: unknown[]) => {
    log.info({ console: true }, formatConsoleArgs(args));
  };

  console.error = (...args: unknown[]) => {
    log.error({ console: true }, formatConsoleArgs(args));
  };

  console.warn = (...args: unknown[]) => {
    log.warn({ console: true }, formatConsoleArgs(args));
  };

  console.info = (...args: unknown[]) => {
    log.info({ console: true }, formatConsoleArgs(args));
  };

  console.debug = (...args: unknown[]) => {
    log.debug({ console: true }, formatConsoleArgs(args));
  };
}

/**
 * Format console arguments into a string for pino.
 */
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
