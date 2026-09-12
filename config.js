// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
// This file is served publicly — anyone with the site link can read the key.
// That is fine for a free-tier key (worst case someone burns the daily quota
// and you generate a new one). Never put a paid key here.
//
// New key: https://www.alphavantage.co/support/#api-key
window.CONFIG = {
  ALPHA_VANTAGE_KEY: "HDL0NPUD4OSHFM30",

  // Alpha Vantage free tier limits. The app tracks usage against DAILY_LIMIT
  // and spaces requests by MIN_REQUEST_GAP_MS to respect the burst limit.
  DAILY_LIMIT: 25,
  MIN_REQUEST_GAP_MS: 1200,

  // Cloudflare Worker proxying BSE for live prices and intraday charts.
  // BSE refuses browser requests directly (no CORS, and it requires a
  // bseindia.com Referer), so the Worker adds the headers server-side.
  // Source lives in worker/. Leave empty to disable live data entirely —
  // the page then falls back to Alpha Vantage closing prices.
  WORKER_URL: "https://bse-proxy.nandish03khandhar.workers.dev",

  // How often to re-poll the live price while the market is open (ms).
  LIVE_POLL_MS: 30000,

  // Shown on first visit. Afterwards the viewer's own list is used.
  DEFAULT_TICKERS: ["RELIANCE.BSE", "TCS.BSE", "INFY.BSE", "HDFCBANK.BSE"],
};
