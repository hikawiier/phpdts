/**
 * @module K 状态管理层
 */

export const DEBUG_FLAGS = ['ai', 'actor', 'labels', 'error-poll'] as const;

export type DebugFlag = (typeof DEBUG_FLAGS)[number];

const KNOWN_FLAGS = new Set<string>(DEBUG_FLAGS);

export function parseDebugFlags(search?: string): ReadonlySet<DebugFlag> {
  const source = search
    ?? (typeof window !== 'undefined' ? window.location.search : '');
  const params = new URLSearchParams(source);
  const requested = params
    .getAll('debug')
    .flatMap(value => value.split(','))
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  if (requested.includes('all')) return new Set(DEBUG_FLAGS);

  return new Set(
    requested.filter((flag): flag is DebugFlag => KNOWN_FLAGS.has(flag)),
  );
}

export const debugFlags = parseDebugFlags();

export function isDebugEnabled(flag: DebugFlag): boolean {
  return debugFlags.has(flag);
}

export function isDebugAllEnabled(search?: string): boolean {
  const source = search
    ?? (typeof window !== 'undefined' ? window.location.search : '');
  return new URLSearchParams(source)
    .getAll('debug')
    .flatMap(value => value.split(','))
    .some(value => value.trim().toLowerCase() === 'all');
}
