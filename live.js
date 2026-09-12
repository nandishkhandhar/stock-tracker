// ---------------------------------------------------------------------------
// Live data — BSE, via the Cloudflare Worker proxy
// ---------------------------------------------------------------------------
// BSE rejects requests without a bseindia.com Referer, which a browser cannot
// send cross-origin, so these calls go through the Worker in worker/.
//
// Everything here is best-effort: if the Worker is unreachable or BSE is down,
// callers fall back to Alpha Vantage closing prices rather than showing an
// error. Live data is an enhancement, not a dependency.

const BASE = () => (window.CONFIG?.WORKER_URL || "").replace(/\/$/, "");

export function liveEnabled() {
  return Boolean(BASE());
}

async function call(path, code, timeoutMs = 6000) {
  if (!BASE()) return null;

  // Without a timeout a hung proxy would leave cards spinning indefinitely.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE()}${path}?code=${encodeURIComponent(code)}`, {
      signal: ctrl.signal,
    });
    const json = await res.json();
    if (!res.ok || json.error) return null;
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Live quote, or null if unavailable. */
export function getQuote(scripCode) {
  return call("/quote", scripCode);
}

/** Today's intraday ticks, or null if unavailable. */
export function getIntraday(scripCode) {
  return call("/intraday", scripCode);
}

// --- ticker directory ------------------------------------------------------

// scrips.json ships with the site: every active BSE equity, as {c: code,
// s: ticker, n: name}. Search runs locally, so it needs no API and no quota.
let directory = null;
let loading = null;

export function loadDirectory() {
  if (directory) return Promise.resolve(directory);
  if (loading) return loading;

  loading = fetch("scrips.json")
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => {
      directory = rows;
      return rows;
    })
    .catch(() => {
      directory = [];
      return directory;
    });

  return loading;
}

/** BSE scrip code for a ticker like "RELIANCE.BSE", or null. */
export function scripCodeFor(symbol) {
  if (!directory) return null;
  const base = symbol.split(".")[0].toUpperCase();
  const hit = directory.find((r) => r.s.toUpperCase() === base);
  return hit ? hit.c : null;
}

/**
 * Local ticker search, ranked: exact ticker, then ticker prefix, then name.
 */
export async function search(query) {
  const rows = await loadDirectory();
  const q = query.trim().toUpperCase();
  if (q.length < 1) return [];

  const exact = [];
  const prefix = [];
  const nameHit = [];

  for (const r of rows) {
    const sym = r.s.toUpperCase();
    if (sym === q) exact.push(r);
    else if (sym.startsWith(q)) prefix.push(r);
    else if (r.n.toUpperCase().includes(q)) nameHit.push(r);
    if (exact.length + prefix.length + nameHit.length > 300) break;
  }

  return [...exact, ...prefix, ...nameHit].slice(0, 8).map((r) => ({
    symbol: r.s + ".BSE",
    name: r.n,
    exchange: "BSE",
    code: r.c,
  }));
}
