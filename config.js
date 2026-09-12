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

  // Shown on first visit. Afterwards the viewer's own list is used.
  DEFAULT_TICKERS: ["RELIANCE.BSE", "TCS.BSE", "INFY.BSE", "HDFCBANK.BSE"],
};
