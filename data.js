// ---------------------------------------------------------------------------
// Data layer — Alpha Vantage, with aggressive caching to respect a 25/day quota
// ---------------------------------------------------------------------------
// Everything the UI needs comes from a single TIME_SERIES_DAILY call per ticker:
// the chart history AND the latest close both come out of that one response, so
// a ticker costs one request rather than two.
//
// Other sources were tested and rejected: NSE's API returns 403 to browsers,
// Yahoo Finance sends no CORS headers, Stooq sits behind a bot wall, and Twelve
// Data paywalls Indian exchanges on the free tier. Twelve Data's *symbol search*
// is keyless and CORS-enabled, so it is still used for ticker lookup.

import { isCacheFresh } from "./freshness.js";

const CACHE_KEY = "stock_cache_v1";
const USAGE_KEY = "stock_usage_v1";

// --- request budget --------------------------------------------------------

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function readUsage() {
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
    if (u.date !== todayStamp()) return { date: todayStamp(), count: 0 };
    return u;
  } catch {
    return { date: todayStamp(), count: 0 };
  }
}

function bumpUsage() {
  const u = readUsage();
  u.count += 1;
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  } catch {}
  window.dispatchEvent(new CustomEvent("usage-changed"));
  return u;
}

export function requestsRemaining() {
  return Math.max(0, CONFIG.DAILY_LIMIT - readUsage().count);
}

// --- cache -----------------------------------------------------------------

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

// --- request serialization -------------------------------------------------

// Alpha Vantage rejects bursts, so calls are chained one after another with a
// gap rather than fired in parallel.
let chain = Promise.resolve();
let lastRequestAt = 0;

function serialize(fn) {
  const run = chain.then(async () => {
    const gap = Date.now() - lastRequestAt;
    if (gap < CONFIG.MIN_REQUEST_GAP_MS) {
      await new Promise((r) => setTimeout(r, CONFIG.MIN_REQUEST_GAP_MS - gap));
    }
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the chain alive even when one link rejects.
  chain = run.catch(() => {});
  return run;
}

// --- errors ----------------------------------------------------------------

export class QuotaError extends Error {}
export class TickerError extends Error {}

// --- public API ------------------------------------------------------------

/**
 * Daily series for one ticker. Returns { symbol, points, latest, previous,
 * change, changePct, fetchedAt, fromCache }, where points is chronological
 * [{ date, close }].
 */
export async function getDaily(symbol, { force = false } = {}) {
  const cache = readCache();
  const hit = cache[symbol];

  if (!force && isCacheFresh(hit)) {
    return { ...hit.data, fromCache: true };
  }

  if (requestsRemaining() <= 0) {
    // Stale data beats no data once the quota is gone.
    if (hit) return { ...hit.data, fromCache: true, stale: true };
    throw new QuotaError(
      "Daily request limit reached. Alpha Vantage allows 25 per day; the count resets tomorrow."
    );
  }

  const url =
    "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY" +
    `&symbol=${encodeURIComponent(symbol)}` +
    "&outputsize=compact" +
    `&apikey=${CONFIG.ALPHA_VANTAGE_KEY}`;

  const json = await serialize(async () => {
    const res = await fetch(url);
    bumpUsage();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });

  if (json["Error Message"]) {
    throw new TickerError(`"${symbol}" was not recognised by Alpha Vantage.`);
  }

  // Rate limit and quota exhaustion both arrive as Note/Information rather
  // than an HTTP error, so they are detected by inspecting the text.
  const notice = json["Note"] || json["Information"];
  if (notice) {
    if (hit) return { ...hit.data, fromCache: true, stale: true };
    throw new QuotaError(
      /premium|rate limit|per day|sparingly/i.test(notice)
        ? "Alpha Vantage rate limit hit. Wait a moment, or try again tomorrow if the daily 25 are used up."
        : notice
    );
  }

  const series = json["Time Series (Daily)"];
  if (!series) throw new TickerError(`No data returned for "${symbol}".`);

  const points = Object.entries(series)
    .map(([date, row]) => ({ date, close: parseFloat(row["4. close"]) }))
    .filter((p) => Number.isFinite(p.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!points.length) throw new TickerError(`No price history for "${symbol}".`);

  const latest = points[points.length - 1];
  const previous = points[points.length - 2] || latest;
  const change = latest.close - previous.close;

  const data = {
    symbol,
    points,
    latest,
    previous,
    change,
    changePct: previous.close ? (change / previous.close) * 100 : 0,
    fetchedAt: Date.now(),
  };

  cache[symbol] = { fetchedAt: Date.now(), data };
  writeCache(cache);

  return { ...data, fromCache: false };
}

/**
 * Ticker search. Twelve Data's symbol_search needs no key and sends CORS
 * headers; results are filtered to India and mapped to Alpha Vantage's
 * .BSE / .NS suffix form.
 */
export async function searchTickers(query) {
  const q = query.trim();
  if (q.length < 2) return [];

  const res = await fetch(
    `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(q)}`
  );
  if (!res.ok) return [];

  const json = await res.json();
  const rows = (json.data || []).filter((r) => r.country === "India");

  // Collapse duplicate listings, preferring BSE since that is what the free
  // Alpha Vantage tier reliably serves.
  const seen = new Map();
  for (const r of rows) {
    const suffix = r.exchange === "BSE" ? ".BSE" : ".NS";
    const symbol = r.symbol + suffix;
    const key = r.instrument_name + "|" + r.symbol;
    if (!seen.has(key) || r.exchange === "BSE") {
      seen.set(key, { symbol, name: r.instrument_name, exchange: r.exchange });
    }
  }

  return [...seen.values()].slice(0, 8);
}

export function removeFromCache(symbol) {
  const cache = readCache();
  delete cache[symbol];
  writeCache(cache);
}
