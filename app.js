import { getDaily, requestsRemaining, removeFromCache, QuotaError, TickerError } from "./data.js";
import { drawChart } from "./chart.js";
import { marketOpen } from "./freshness.js";
import * as live from "./live.js";

const LIST_KEY = "stock_watchlist_v1";

// 1D comes from BSE intraday ticks; the rest are daily closes from Alpha
// Vantage, whose free tier caps history at 100 trading days (~5 months).
const RANGES = { "1D": "intraday", "1W": 5, "1M": 22, "3M": 66, "5M": 100 };
const RANGE_LABELS = { "1D": "today", "1W": "1 week", "1M": "1 month", "3M": "3 months", "5M": "5 months" };

const $ = (id) => document.getElementById(id);
const cardsEl = $("cards");
const searchEl = $("search");
const resultsEl = $("results");
const bannerEl = $("banner");
const quotaEl = $("quota");
const emptyEl = $("empty");

// [{ symbol, name, code, range }]
let watchlist = loadList();

// symbol -> { daily, intraday, quote } so range switches need no refetch
const state = new Map();

// --- watchlist persistence -------------------------------------------------

function loadList() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_KEY));
    if (Array.isArray(saved) && saved.length) {
      return saved.map((s) => (typeof s === "string" ? { symbol: s } : s));
    }
  } catch {}
  return CONFIG.DEFAULT_TICKERS.map((symbol) => ({ symbol }));
}

function saveList() {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(watchlist));
  } catch {}
}

// --- chrome ----------------------------------------------------------------

function updateQuota() {
  const left = requestsRemaining();
  const liveBit = live.liveEnabled() ? "Live · " : "";
  quotaEl.textContent = `${liveBit}${left}/${CONFIG.DAILY_LIMIT} history requests left`;
  quotaEl.classList.toggle("low", left <= 3);
}

function showBanner(msg, kind = "error") {
  bannerEl.textContent = msg;
  bannerEl.className = "banner " + kind;
  bannerEl.hidden = false;
}

const hideBanner = () => (bannerEl.hidden = true);

const fmt = (n) =>
  Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function prettyDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${y}`;
}

// --- card shell ------------------------------------------------------------

function cardShell(entry) {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.symbol = entry.symbol;

  const base = entry.symbol.split(".")[0];
  card.innerHTML = `
    <button class="remove" title="Remove ${base}" aria-label="Remove ${base}">×</button>
    <div class="card-head">
      <div class="card-id">
        <div class="card-sym">${base}<span class="exch-pill">BSE</span></div>
        <div class="card-name">${entry.name || ""}</div>
      </div>
      <div class="card-price"></div>
    </div>
    <div class="range-row">
      <div class="ranges"></div>
      <div class="period-change"></div>
    </div>
    <div class="chart-wrap"><div class="skeleton"></div></div>
  `;

  card.querySelector(".remove").addEventListener("click", () => removeTicker(entry.symbol));
  return card;
}

// --- rendering -------------------------------------------------------------

/**
 * Change across the visible chart window: first point to last, using the live
 * price as the endpoint when one is available so the figure agrees with the
 * price shown above it.
 */
function periodChange(entry) {
  const st = state.get(entry.symbol) || {};
  const active = entry.range || "1M";

  let series;
  if (active === "1D") {
    series = st.intraday?.points;
    // Intraday moves are measured from the previous close, which is where the
    // session actually started, not from the first tick of the day.
    if (series?.length) {
      const base = st.intraday.prevClose ?? series[0].close;
      const end = st.quote?.price ?? series[series.length - 1].close;
      if (base) return { abs: end - base, pct: ((end - base) / base) * 100, label: "today" };
    }
    return null;
  }

  series = st.daily?.points;
  if (!series || series.length < 2) return null;

  const slice = series.slice(-RANGES[active]);
  if (slice.length < 2) return null;

  const base = slice[0].close;
  // Live price is the truest endpoint during the session.
  const end = st.quote?.price ?? slice[slice.length - 1].close;
  if (!base) return null;

  return { abs: end - base, pct: ((end - base) / base) * 100, label: RANGE_LABELS[active] };
}

function renderPrice(card, entry) {
  const st = state.get(entry.symbol) || {};
  const { quote, daily } = st;
  const priceEl = card.querySelector(".card-price");

  // Prefer the live quote; fall back to the most recent daily close.
  let price, change, changePct, asOf, isLive;

  if (quote && quote.price != null) {
    ({ price, change, changePct } = quote);
    isLive = true;
    asOf = marketOpen()
      ? `Live · ${new Date(quote.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`
      : "Last traded";
  } else if (daily) {
    price = daily.latest.close;
    change = daily.change;
    changePct = daily.changePct;
    isLive = false;
    asOf = `Close · ${prettyDate(daily.latest.date)}`;
  } else {
    return;
  }

  const up = (change ?? 0) >= 0;
  const sign = up ? "+" : "";

  priceEl.innerHTML = `
    <div class="price-now">
      ₹${fmt(price)}${isLive && marketOpen() ? '<span class="live-dot" title="Live"></span>' : ""}
    </div>
    <div class="price-change ${up ? "up" : "down"}">
      ${change == null ? "" : `${sign}${fmt(change)}`}
      ${changePct == null ? "" : `(${sign}${Number(changePct).toFixed(2)}%)`}
    </div>
    <div class="price-asof">${asOf}</div>
  `;
}

function renderChart(card, entry) {
  const st = state.get(entry.symbol) || {};
  const active = entry.range || "1M";
  const wrap = card.querySelector(".chart-wrap");

  if (active === "1D") {
    const intra = st.intraday;
    if (!intra) {
      wrap.innerHTML = '<div class="skeleton"></div>';
      return;
    }
    if (!intra.points || intra.points.length < 2) {
      wrap.innerHTML =
        '<p class="chart-empty">No intraday data — the market has not traded today.</p>';
      return;
    }
    const first = intra.points[0].close;
    const last = intra.points[intra.points.length - 1].close;
    drawChart(wrap, intra.points, { rising: last >= first });
    return;
  }

  const daily = st.daily;
  if (!daily) {
    wrap.innerHTML = '<div class="skeleton"></div>';
    return;
  }

  const slice = daily.points.slice(-RANGES[active]);
  const rising =
    slice.length > 1 ? slice[slice.length - 1].close >= slice[0].close : true;
  drawChart(wrap, slice, { rising });
}

function renderPeriod(card, entry) {
  const el = card.querySelector(".period-change");
  if (!el) return;

  const pc = periodChange(entry);
  if (!pc) {
    el.textContent = "";
    el.className = "period-change";
    return;
  }

  const up = pc.abs >= 0;
  const sign = up ? "+" : "";
  el.className = "period-change " + (up ? "up" : "down");
  el.innerHTML =
    `<span class="period-pct">${sign}${pc.pct.toFixed(2)}%</span>` +
    `<span class="period-abs">${sign}₹${fmt(Math.abs(pc.abs))}</span>` +
    `<span class="period-label">over ${pc.label}</span>`;
}

function renderRanges(card, entry) {
  const rangesEl = card.querySelector(".ranges");
  const active = entry.range || "1M";
  rangesEl.innerHTML = "";

  for (const label of Object.keys(RANGES)) {
    // 1D needs the Worker; hide it when live data is switched off.
    if (label === "1D" && !live.liveEnabled()) continue;

    const btn = document.createElement("button");
    btn.className = "range-btn" + (label === active ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      entry.range = label;
      saveList();
      renderRanges(card, entry);
      renderChart(card, entry);
      renderPeriod(card, entry);
      // Intraday is fetched lazily, the first time 1D is opened.
      if (label === "1D" && entry.code && !state.get(entry.symbol)?.intraday) {
        const intra = await live.getIntraday(entry.code);
        if (intra) {
          const st = state.get(entry.symbol) || {};
          state.set(entry.symbol, { ...st, intraday: intra });
          if (entry.range === "1D") {
            renderChart(card, entry);
            renderPeriod(card, entry);
          }
        } else if (entry.range === "1D") {
          card.querySelector(".chart-wrap").innerHTML =
            '<p class="chart-empty">Intraday data unavailable right now.</p>';
        }
      }
    });
    rangesEl.appendChild(btn);
  }
}

function renderCardError(card, message) {
  card.querySelector(".chart-wrap").innerHTML = `<p class="card-error">${message}</p>`;
}

// --- loading ---------------------------------------------------------------

async function loadCard(card, entry, opts = {}) {
  // Resolve the BSE scrip code once; live endpoints are keyed by it.
  if (!entry.code) {
    await live.loadDirectory();
    entry.code = live.scripCodeFor(entry.symbol);
    if (entry.code) saveList();
  }

  // Live quote first — it is free and fast, so the card shows a price
  // immediately even while the slower history request is in flight.
  if (entry.code && live.liveEnabled()) {
    live.getQuote(entry.code).then((quote) => {
      if (!quote) return;
      const st = state.get(entry.symbol) || {};
      state.set(entry.symbol, { ...st, quote });
      if (!entry.name && quote.name) {
        entry.name = quote.name;
        saveList();
        const n = card.querySelector(".card-name");
        if (n) n.textContent = quote.name;
      }
      renderPrice(card, entry);
      renderPeriod(card, entry);
    });
  }

  renderRanges(card, entry);

  try {
    const daily = await getDaily(entry.symbol, opts);
    const st = state.get(entry.symbol) || {};
    state.set(entry.symbol, { ...st, daily });
    renderPrice(card, entry);
    renderChart(card, entry);
    renderPeriod(card, entry);
    updateQuota();
    return true;
  } catch (err) {
    updateQuota();
    // With a live quote on screen, a history failure is a degraded card, not
    // a broken one.
    const hasQuote = state.get(entry.symbol)?.quote;
    if (err instanceof QuotaError) {
      renderCardError(card, hasQuote
        ? "Live price only — daily history limit reached."
        : "Daily request limit reached — try again tomorrow.");
      if (!hasQuote) showBanner(err.message);
    } else if (err instanceof TickerError) {
      renderCardError(card, hasQuote ? "No chart history for this stock." : err.message);
    } else {
      renderCardError(card, "Could not load history.");
    }
    return Boolean(hasQuote);
  }
}

// --- list operations -------------------------------------------------------

async function renderAll({ force = false } = {}) {
  cardsEl.innerHTML = "";
  emptyEl.hidden = watchlist.length > 0;

  for (const entry of watchlist) cardsEl.appendChild(cardShell(entry));

  for (let i = 0; i < watchlist.length; i++) {
    await loadCard(cardsEl.children[i], watchlist[i], { force });
  }
}

async function addTicker(symbol, name, code) {
  if (watchlist.some((e) => e.symbol === symbol)) {
    showBanner(`${symbol.split(".")[0]} is already on your list.`, "info");
    setTimeout(hideBanner, 2500);
    return;
  }

  const entry = { symbol, name, code };
  watchlist.push(entry);
  saveList();
  emptyEl.hidden = true;

  const card = cardShell(entry);
  cardsEl.appendChild(card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const ok = await loadCard(card, entry);
  if (!ok && card.querySelector(".card-error")) {
    watchlist = watchlist.filter((e) => e.symbol !== symbol);
    saveList();
    setTimeout(() => {
      card.remove();
      emptyEl.hidden = watchlist.length > 0;
    }, 2600);
  }
}

function removeTicker(symbol) {
  watchlist = watchlist.filter((e) => e.symbol !== symbol);
  saveList();
  removeFromCache(symbol);
  state.delete(symbol);
  cardsEl.querySelector(`[data-symbol="${CSS.escape(symbol)}"]`)?.remove();
  emptyEl.hidden = watchlist.length > 0;
}

// --- search ----------------------------------------------------------------

let searchTimer;
let activeIndex = -1;

function closeResults() {
  resultsEl.hidden = true;
  resultsEl.innerHTML = "";
  activeIndex = -1;
}

function showResults(rows) {
  resultsEl.innerHTML = "";
  activeIndex = -1;

  if (!rows.length) {
    resultsEl.innerHTML = '<div class="results-msg">No matching stock found.</div>';
    resultsEl.hidden = false;
    return;
  }

  for (const row of rows) {
    const div = document.createElement("div");
    div.className = "result";
    div.innerHTML = `
      <span class="result-sym">${row.symbol.split(".")[0]}</span>
      <span class="result-name">${row.name}</span>
      <span class="result-exch">${row.exchange}</span>
    `;
    div.addEventListener("click", () => {
      searchEl.value = "";
      closeResults();
      addTicker(row.symbol, row.name, row.code);
    });
    resultsEl.appendChild(div);
  }
  resultsEl.hidden = false;
}

searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchEl.value.trim();
  if (q.length < 1) return closeResults();
  // The directory is local, so this debounce is only to avoid rerendering
  // the list on every keystroke.
  searchTimer = setTimeout(async () => showResults(await live.search(q)), 120);
});

searchEl.addEventListener("keydown", (e) => {
  const items = [...resultsEl.querySelectorAll(".result")];
  if (e.key === "Escape") return closeResults();
  if (!items.length) return;

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    activeIndex = (activeIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
    items[activeIndex].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    (items[activeIndex] || items[0]).click();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-area")) closeResults();
});

// --- refresh ---------------------------------------------------------------

$("refresh").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (requestsRemaining() < watchlist.length) {
    showBanner(
      `Refreshing all ${watchlist.length} needs more than the ${requestsRemaining()} history requests left today.`
    );
    return;
  }
  hideBanner();
  btn.classList.add("spin");
  state.clear();
  await renderAll({ force: true });
  btn.classList.remove("spin");
});

// --- live polling ----------------------------------------------------------

// Only the live quote is polled. Daily history is untouched, so this costs
// nothing against the Alpha Vantage quota.
function startLivePolling() {
  if (!live.liveEnabled()) return;

  setInterval(async () => {
    if (!marketOpen() || document.hidden) return;

    for (const entry of watchlist) {
      if (!entry.code) continue;
      const quote = await live.getQuote(entry.code);
      if (!quote) continue;

      const st = state.get(entry.symbol) || {};
      state.set(entry.symbol, { ...st, quote });

      const card = cardsEl.querySelector(`[data-symbol="${CSS.escape(entry.symbol)}"]`);
      if (card) {
        renderPrice(card, entry);
        renderPeriod(card, entry);
      }

      // Keep an open 1D chart moving with the price.
      if (entry.range === "1D") {
        const intra = await live.getIntraday(entry.code);
        if (intra) {
          state.set(entry.symbol, { ...state.get(entry.symbol), intraday: intra });
          if (card) {
            renderChart(card, entry);
            renderPeriod(card, entry);
          }
        }
      }
    }
  }, CONFIG.LIVE_POLL_MS || 30000);
}

window.addEventListener("usage-changed", updateQuota);

// --- start -----------------------------------------------------------------

if (!CONFIG.ALPHA_VANTAGE_KEY) {
  showBanner("No API key set in config.js — chart history cannot load.");
}

updateQuota();
live.loadDirectory();
renderAll().then(startLivePolling);
