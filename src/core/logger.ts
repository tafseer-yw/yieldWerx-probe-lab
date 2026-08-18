/**
 * Lightweight structured logger (zero dependencies).
 *
 * WHY: the framework needs consistent, machine-parseable logs in CI and
 * readable ones locally without pulling in a logging library at the bottom
 * of the dependency graph (src/core imports nothing above it, and everything
 * above it may import this).
 *
 * - JSON lines when LOG_FORMAT=json (CI), human-readable otherwise.
 * - Level-filtered via LOG_LEVEL (debug|info|warn|error, default info).
 * - `child()` creates nested contexts: "WaferMap:sync".
 * - `capture()` tees log lines into a per-scenario buffer so fixtures can
 *   attach them to the report (see src/core/fixtures.ts).
 */

/** Log severity, ordered debug < info < warn < error. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isJson = process.env.LOG_FORMAT === 'json';
const configuredLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;

/** Numeric ranks used for level filtering (higher = more severe). */
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Decide whether a message at the given level passes the LOG_LEVEL filter.
 * Unknown levels (e.g. a typo in LOG_LEVEL) fall back to the info rank, so a
 * misconfigured filter degrades to the default rather than silencing logs.
 *
 * @param msgLevel - Level of the message being emitted.
 * @returns True when the message is at or above the configured level.
 */
function shouldLog(msgLevel: LogLevel): boolean {
  return (LEVELS[msgLevel] ?? 1) >= (LEVELS[configuredLevel] ?? 1);
}

/**
 * Render one log line. In JSON mode the meta object is spread into the
 * top-level record (flat keys are friendlier to log processors); in human
 * mode it is appended as a JSON suffix after a fixed-width
 * `[ts] [LEVEL] [context]` prefix so lines align visually.
 *
 * @param lvl - Message severity.
 * @param context - Logger context chain (e.g. "WaferMap:sync").
 * @param message - Human-readable message text.
 * @param meta - Optional structured payload.
 * @returns The fully formatted line (no trailing newline).
 */
function format(
  lvl: LogLevel,
  context: string,
  message: string,
  meta?: Record<string, unknown>,
): string {
  const ts = new Date().toISOString();
  if (isJson) {
    return JSON.stringify({ ts, level: lvl, context, message, ...meta });
  }
  const prefix = `[${ts}] [${lvl.toUpperCase().padEnd(5)}] [${context}]`;
  const metaStr = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${prefix} ${message}${metaStr}`;
}

/**
 * Public logging surface handed out by {@link createLogger}. All methods
 * accept an optional structured meta object; `child` derives a logger whose
 * context is suffixed (parent "WaferMap" → child "WaferMap:sync").
 */
export interface Logger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  child: (subContext: string) => Logger;
}

/** Sinks registered by fixtures to capture per-scenario logs for report attachment. */
type LogSink = (line: string) => void;
const sinks = new Set<LogSink>();

/**
 * Register a capture sink. Returns an unsubscribe function.
 * Used by the `log` fixture to attach scenario logs to reports.
 *
 * Every formatted line that passes the level filter is teed to all active
 * sinks in addition to stdout/stderr — this is how per-scenario log capture
 * works without any global mutable scenario state.
 *
 * @param sink - Callback receiving each formatted log line.
 * @returns Unsubscribe function; call it on scenario teardown.
 * @example
 * const lines: string[] = [];
 * const unsubscribe = captureLogs((l) => lines.push(l));
 * // ... run scenario ...
 * unsubscribe();
 */
export function captureLogs(sink: LogSink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

/**
 * Create a named logger. Routing: `error` → console.error, `warn` →
 * console.warn, everything else → raw stdout (avoids console.log's extra
 * formatting). Each emitted line is also forwarded to registered capture
 * sinks (see {@link captureLogs}).
 *
 * @param context - Context label shown on every line (e.g. class name).
 * @returns A {@link Logger} bound to that context.
 * @example
 * const log = createLogger('WaferMap');
 * log.info('render complete', { traces: 2 });
 * const syncLog = log.child('sync'); // context "WaferMap:sync"
 */
export function createLogger(context: string): Logger {
  const log = (lvl: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    if (!shouldLog(lvl)) return;
    const line = format(lvl, context, message, meta);
    if (lvl === 'error') console.error(line);
    else if (lvl === 'warn') console.warn(line);
    else process.stdout.write(`${line}\n`);
    for (const sink of sinks) sink(line);
  };

  return {
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    child: (subContext) => createLogger(`${context}:${subContext}`),
  };
}
