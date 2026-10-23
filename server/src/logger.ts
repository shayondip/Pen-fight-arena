type Level = 'info' | 'warn' | 'error' | 'debug';

const COLOURS: Record<Level, string> = {
  info: '\u001b[36m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
  debug: '\u001b[90m',
};

const RESET = '\u001b[0m';
const DEBUG_ENABLED = process.env.PFA_DEBUG === 'true';

function write(level: Level, message: string, ...rest: unknown[]): void {
  if (level === 'debug' && !DEBUG_ENABLED) return;
  const stamp = new Date().toISOString().slice(11, 23);
  const prefix = `${COLOURS[level]}[pfa ${stamp} ${level}]${RESET}`;
  if (level === 'error') {
    console.error(prefix, message, ...rest);
  } else if (level === 'warn') {
    console.warn(prefix, message, ...rest);
  } else {
    console.log(prefix, message, ...rest);
  }
}

export const logger = {
  info: (message: string, ...rest: unknown[]) => write('info', message, ...rest),
  warn: (message: string, ...rest: unknown[]) => write('warn', message, ...rest),
  error: (message: string, ...rest: unknown[]) => write('error', message, ...rest),
  debug: (message: string, ...rest: unknown[]) => write('debug', message, ...rest),
};
