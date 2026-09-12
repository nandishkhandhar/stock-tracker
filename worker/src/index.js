// ---------------------------------------------------------------------------
// BSE proxy — Cloudflare Worker
// ---------------------------------------------------------------------------
// BSE's API refuses requests that lack a bseindia.com Referer. A browser cannot
// forge that header cross-origin, so the page cannot call BSE directly. This
// Worker adds the header server-side and re-serves the response with CORS
// headers the browser will accept.
//
// Routes:
//   /quote?code=500325   live price, previous close, day range
//   /intraday?code=500325   today's minute-by-minute ticks
//
// Responses are cached briefly at the edge so repeated loads do not hammer BSE.

const BSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.bseindia.com/",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// Seconds to cache each route at the edge. Quotes move constantly during the
// session; intraday series only gains a point a minute.
const TTL = { quote: 20, intraday: 60 };

function corsJSON(body, status = 200, ttl = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store",
    },
  });
}

function isScripCode(code) {
  return /^\d{6}$/.test(code || "");
}

async function fetchBSE(url, ttl) {
  const res = await fetch(url, {
    headers: BSE_HEADERS,
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`BSE responded ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // BSE serves an HTML "Access Denied" page rather than a JSON error.
    throw new Error("BSE returned a non-JSON response");
  }
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Live quote: last traded price, previous close, day's range. */
async function handleQuote(code) {
  const data = await fetchBSE(
    `https://api.bseindia.com/BseIndiaAPI/api/getScripHeaderData/w?Debtflag=&scripcode=${code}&seriesid=`,
    TTL.quote
  );

  const head = data.Header || {};
  const rate = data.CurrRate || {};
  const name = data.Cmpname || {};

  const price = num(rate.LTP) ?? num(head.LTP);
  if (price === null) throw new Error("no price in BSE response");

  const prevClose = num(head.PrevClose);
  // Prefer BSE's own change figure; fall back to computing it.
  const change = num(rate.Chg) ?? (prevClose !== null ? price - prevClose : null);
  const changePct =
    num(rate.PcChg) ??
    (prevClose ? ((price - prevClose) / prevClose) * 100 : null);

  return {
    code,
    name: (name.FullN || "").trim() || null,
    price,
    prevClose,
    change,
    changePct,
    open: num(head.Open),
    high: num(head.High),
    low: num(head.Low),
    at: Date.now(),
  };
}

/** Today's intraday ticks, for the 1D chart. */
async function handleIntraday(code) {
  const data = await fetchBSE(
    `https://api.bseindia.com/BseIndiaAPI/api/StockReachGraph/w?scripcode=${code}&flag=0&fromdate=&todate=&seriesid=`,
    TTL.intraday
  );

  let rows = [];
  try {
    rows = JSON.parse(data.Data || "[]");
  } catch {
    rows = [];
  }

  const points = rows
    .map((r) => ({ t: Date.parse(r.dttm), close: num(r.vale1) }))
    .filter((p) => Number.isFinite(p.t) && p.close !== null)
    // BSE returns newest-first; charts want chronological order.
    .sort((a, b) => a.t - b.t);

  return {
    code,
    name: (data.Scripname || "").trim() || null,
    points,
    price: num(data.CurrVal),
    prevClose: num(data.PrevClose),
    at: Date.now(),
  };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const code = url.searchParams.get("code");

    if (url.pathname === "/") {
      return corsJSON({
        ok: true,
        routes: ["/quote?code=500325", "/intraday?code=500325"],
      });
    }

    if (!isScripCode(code)) {
      return corsJSON({ error: "code must be a 6-digit BSE scrip code" }, 400);
    }

    try {
      if (url.pathname === "/quote") {
        return corsJSON(await handleQuote(code), 200, TTL.quote);
      }
      if (url.pathname === "/intraday") {
        return corsJSON(await handleIntraday(code), 200, TTL.intraday);
      }
      return corsJSON({ error: "not found" }, 404);
    } catch (err) {
      // The page falls back to Alpha Vantage closes when this fails, so a
      // clear error matters more than a clever recovery here.
      return corsJSON({ error: String(err.message || err) }, 502);
    }
  },
};
