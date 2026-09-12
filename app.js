import { getDaily, searchTickers, requestsRemaining, removeFromCache, QuotaError, TickerError } from "./data.js";
import { drawChart } from "./chart.js";

const LIST_KEY = "stock_watchlist_v1";
// Alpha Vantage's free tier caps TIME_SERIES_DAILY at 100 trading days
// (outputsize=full is a paid feature), so ~5 months is all the history there
// is. Ranges stop there rather than showing 6M/1Y buttons that silently
// render the same 100 points.
const RANGES = { "1M": 22, "3M": 66, "5M": 100 };

const $ = (id) => document.getElementById(id);
const cardsEl = $("cards");
const searchEl = $("search");
const resultsEl = $("results");
const bannerEl = $("banner");
const quotaEl = $("quota");
const emptyEl = $("empty");

// symbol -> { name, range }
let watchlist = loadList();

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
  quotaEl.textContent = `${left}/${CONFIG.DAILY_LIMIT} requests left today`;
  quotaEl.classList.toggle("low", left <= 3);
}

function showBanner(msg, kind = "error") {
  bannerEl.textContent = msg;
  bannerEl.className = "banner " + kind;
  bannerEl.hidden = false;
}

function hideBanner() {
  bannerEl.hidden = true;
}

const fmt = (n) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function prettyDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${y}`;
}

// --- cards -----------------------------------------------------------------

function cardShell(entry) {
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.symbol = entry.symbol;

  const [base, exch] = entry.symbol.split(".");
  card.innerHTML = `
    <button class="remove" title="Remove ${base}" aria-label="Remove ${base}">×</button>
    <div class="card-head">
      <div class="card-id">
        <div class="card-sym">${base}<span class="exch-pill">${exch === "BSE" ? "BSE" : "NSE"}</span></div>
        <div class="card-name">${entry.name || ""}</div>
      </div>
      <div class="card-price"></div>
    </div>
    <div class="ranges"></div>
    <div class="chart-wrap"><div class="skeleton"></div></div>
  `;

  card.querySelector(".remove").addEventListener("click", () => removeTicker(entry.symbol));
  return card;
}

function renderCard(card, entry, data) {
  const priceEl = card.querySelector(".card-price");
  const rising = data.change >= 0;
  const sign = rising ? "+" : "";

  priceEl.innerHTML = `
    <div class="price-now">₹${fmt(data.latest.close)}</div>
    <div class="price-change ${rising ? "up" : "down"}">
      ${sign}${fmt(data.change)} (${sign}${data.changePct.toFixed(2)}%)
    </div>
    <div class="price-asof">Close · ${prettyDate(data.latest.date)}${data.stale ? " · cached" : ""}</div>
  `;

  const rangesEl = card.querySelector(".ranges");
  rangesEl.innerHTML = "";
  const active = entry.range || "3M";

  for (const label of Object.keys(RANGES)) {
    const btn = document.createElement("button");
    btn.className = "range-btn" + (label === active ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      entry.range = label;
      saveList();
      renderCard(card, entry, data);
    });
    rangesEl.appendChild(btn);
  }

  const slice = data.points.slice(-RANGES[active]);
  const wrap = card.querySelector(".chart-wrap");
  // Colour the chart by the movement across the visible window, which can
  // differ from the single-day change shown above.
  const windowRising = slice.length > 1 ? slice[slice.length - 1].close >= slice[0].close : rising;
  drawChart(wrap, slice, { rising: windowRising });
}

function renderCardError(card, message) {
  card.querySelector(".chart-wrap").innerHTML = `<p class="card-error">${message}</p>`;
}

async function loadCard(card, entry, opts = {}) {
  try {
    const data = await getDaily(entry.symbol, opts);
    // Alpha Vantage does not return a company name, so keep whatever the
    // search gave us and fall back to the ticker.
    renderCard(card, entry, data);
    updateQuota();
    return true;
  } catch (err) {
    updateQuota();
    if (err instanceof QuotaError) {
      renderCardError(card, "Daily request limit reached — try again tomorrow.");
      showBanner(err.message);
    } else if (err instanceof TickerError) {
      renderCardError(card, err.message);
    } else {
      renderCardError(card, "Could not load data. Check your connection.");
    }
    return false;
  }
}

// --- list operations -------------------------------------------------------

async function renderAll({ force = false } = {}) {
  cardsEl.innerHTML = "";
  emptyEl.hidden = watchlist.length > 0;

  for (const entry of watchlist) {
    const card = cardShell(entry);
    cardsEl.appendChild(card);
  }

  // Sequential, not parallel: the data layer serializes requests anyway, and
  // this way each card fills in as soon as its own data lands.
  for (let i = 0; i < watchlist.length; i++) {
    await loadCard(cardsEl.children[i], watchlist[i], { force });
  }
}

async function addTicker(symbol, name) {
  if (watchlist.some((e) => e.symbol === symbol)) {
    showBanner(`${symbol.split(".")[0]} is already on your list.`, "info");
    setTimeout(hideBanner, 2500);
    return;
  }

  const entry = { symbol, name };
  watchlist.push(entry);
  saveList();
  emptyEl.hidden = true;

  const card = cardShell(entry);
  cardsEl.appendChild(card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const ok = await loadCard(card, entry);
  if (!ok) {
    // Do not keep a ticker that returned nothing usable.
    const stillThere = watchlist.some((e) => e.symbol === symbol);
    if (stillThere && card.querySelector(".card-error")) {
      watchlist = watchlist.filter((e) => e.symbol !== symbol);
      saveList();
      setTimeout(() => {
        card.remove();
        emptyEl.hidden = watchlist.length > 0;
      }, 2600);
    }
  }
}

function removeTicker(symbol) {
  watchlist = watchlist.filter((e) => e.symbol !== symbol);
  saveList();
  removeFromCache(symbol);
  const card = cardsEl.querySelector(`[data-symbol="${CSS.escape(symbol)}"]`);
  if (card) card.remove();
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
    resultsEl.innerHTML = '<div class="results-msg">No Indian listings found.</div>';
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
      addTicker(row.symbol, row.name);
    });
    resultsEl.appendChild(div);
  }
  resultsEl.hidden = false;
}

searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchEl.value.trim();
  if (q.length < 2) return closeResults();

  searchTimer = setTimeout(async () => {
    try {
      showResults(await searchTickers(q));
    } catch {
      resultsEl.innerHTML = '<div class="results-msg">Search unavailable.</div>';
      resultsEl.hidden = false;
    }
  }, 260);
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
      `Refreshing all ${watchlist.length} would need more requests than the ${requestsRemaining()} left today.`
    );
    return;
  }
  hideBanner();
  btn.classList.add("spin");
  await renderAll({ force: true });
  btn.classList.remove("spin");
});

window.addEventListener("usage-changed", updateQuota);

// --- start -----------------------------------------------------------------

if (!CONFIG.ALPHA_VANTAGE_KEY) {
  showBanner("No API key set in config.js — prices cannot load.");
}

updateQuota();
renderAll();
