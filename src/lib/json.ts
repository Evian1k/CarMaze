/**
 * Safe JSON column parsing.
 * SQLite stores JSON as strings; a malformed or NULL column must never crash
 * a public read path: always fall back instead of throwing.
 */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback
  try {
    const parsed = JSON.parse(value) as T
    return parsed ?? fallback
  } catch {
    return fallback
  }
}
