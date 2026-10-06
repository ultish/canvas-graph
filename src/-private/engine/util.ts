import type { Port } from './types.ts';

/** Numeric-aware name compare: 2 before 10, A before B. */
export const natural = (p: string, q: string): number => {
  const a = Number(p);
  const b = Number(q);
  return Number.isNaN(a) || Number.isNaN(b) ? p.localeCompare(q) : a - b;
};

export const byName = (p: Port, q: Port): number =>
  natural(p.name, q.name) || p.id.localeCompare(q.id);
