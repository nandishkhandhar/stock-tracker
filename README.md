# 📈 Indian Stock Tracker

A single-page site showing daily closing prices and charts for NSE/BSE stocks.
Static files only — no build step, no server, no framework.

**Live:** https://nandishkhandhar.github.io/stock-tracker/

## What it does

- Search any Indian listed company and add it to a watchlist
- Daily closing price, day-over-day change, and a hoverable line chart
- 1M / 3M / 5M ranges
- Watchlist and price data saved in the browser, so reopening costs no API quota

## Data sources

| Purpose | Source | Notes |
|---|---|---|
| Prices | [Alpha Vantage](https://www.alphavantage.co) `TIME_SERIES_DAILY` | Free tier, needs a key |
| Ticker search | [Twelve Data](https://twelvedata.com) `symbol_search` | No key required |

Several alternatives were tested and rejected: NSE's own API returns 403 to
browsers, Yahoo Finance sends no CORS headers, Stooq sits behind a bot wall, and
Twelve Data's free tier paywalls Indian exchange prices.

## Free-tier limits

Alpha Vantage's free tier allows **25 requests/day, 1 per second**, and caps
history at **100 trading days** (~5 months — `outputsize=full` is a paid
feature). The app works within this:

- One request per stock, not two — the daily series provides both chart and price
- Results cached until a newer close is published, so reopening the page costs nothing
- Requests spaced 1.2s apart to respect the burst limit
- Remaining daily quota shown in the header

A four-stock watchlist costs four requests on the first load of each trading
day, and zero on every reopen after that.

## Setup

Replace the key in `config.js` with your own from
[alphavantage.co](https://www.alphavantage.co/support/#api-key):

```js
window.CONFIG = {
  ALPHA_VANTAGE_KEY: "your-key-here",
  DEFAULT_TICKERS: ["RELIANCE.BSE", "TCS.BSE", "INFY.BSE", "HDFCBANK.BSE"],
};
```

> The key is visible in the page source — that's unavoidable on static hosting.
> Fine for a free key (worst case someone burns the quota and you generate a new
> one); never put a paid key here.

## Running locally

ES modules need a real server, so `file://` won't work:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | Styles, light + dark |
| `config.js` | API key and defaults |
| `data.js` | Fetching, caching, quota tracking |
| `freshness.js` | Decides when cached data needs refetching |
| `chart.js` | SVG line chart, no dependencies |
| `app.js` | UI wiring — search, watchlist, rendering |

## Known limits

- **Closing prices, not live quotes.** Intraday data is a paid Alpha Vantage
  endpoint. Prices update once daily after the 15:30 IST close.
- **~5 months of history**, per the free-tier cap above.
- **Exchange holidays aren't modelled.** On a holiday the app may spend one
  request discovering no new close was published.
