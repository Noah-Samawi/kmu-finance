// Einfacher In-Memory-Schutz gegen Brute-Force beim Login.
// Für mehrere Server-Instanzen später durch Redis ersetzen.
const attempts = new Map<string, { count: number; until: number }>();
const MAX = 8;
const WINDOW_MS = 15 * 60_000;

export function checkLoginAllowed(key: string): boolean {
  const a = attempts.get(key);
  if (!a) return true;
  if (Date.now() > a.until) {
    attempts.delete(key);
    return true;
  }
  return a.count < MAX;
}

export function recordLoginFailure(key: string) {
  const a = attempts.get(key);
  if (!a || Date.now() > a.until) attempts.set(key, { count: 1, until: Date.now() + WINDOW_MS });
  else a.count++;
}

export function resetLogin(key: string) {
  attempts.delete(key);
}

// Allgemeines Fenster-Limit (z. B. KI-Belegscan: schützt vor Kostenmissbrauch)
const hits = new Map<string, number[]>();

/** true = erlaubt (und gezählt), false = Limit erreicht */
export function takeRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
