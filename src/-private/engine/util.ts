import type { Port } from './types.ts';

/** Numeric-aware name compare: 2 before 10, A before B. */
export const natural = (p: string, q: string): number => {
  const a = Number(p);
  const b = Number(q);
  return Number.isNaN(a) || Number.isNaN(b) ? p.localeCompare(q) : a - b;
};

export const byName = (p: Port, q: Port): number =>
  natural(p.name, q.name) || p.id.localeCompare(q.id);

/** Structural equality for plain JSON-like data (what selection payloads are made of). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  )
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka)
    if (
      !deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    )
      return false;
  return true;
}
