// ---------------------------------------------------------------------------
// Line chart — hand-rolled SVG, no library
// ---------------------------------------------------------------------------

const NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function niceTicks(min, max, count = 4) {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
  return ticks;
}

const fmtPrice = (n) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]} ${y}`;
}

/**
 * Render a closing-price line chart into `mount`.
 * points: chronological [{ date, close }]
 */
export function drawChart(mount, points, { rising = true } = {}) {
  mount.innerHTML = "";
  if (points.length < 2) {
    mount.innerHTML = '<p class="chart-empty">Not enough data to plot.</p>';
    return;
  }

  const W = 700;
  const H = 260;
  const pad = { top: 16, right: 56, bottom: 28, left: 12 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const closes = points.map((p) => p.close);
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  // A flat series would collapse to a zero-height range; give it headroom.
  const padY = (hi - lo) * 0.12 || Math.max(hi * 0.02, 1);
  const yMin = lo - padY;
  const yMax = hi + padY;

  const x = (i) => pad.left + (i / (points.length - 1)) * plotW;
  const y = (v) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
    class: "chart-svg",
    role: "img",
    "aria-label": `Closing price from ${fmtDate(points[0].date)} to ${fmtDate(points[points.length - 1].date)}`,
  });

  const stroke = rising ? "var(--up)" : "var(--down)";
  const gradId = "g" + Math.random().toString(36).slice(2, 9);

  const defs = el("defs");
  const grad = el("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "0", y2: "1" });
  grad.appendChild(el("stop", { offset: "0%", "stop-color": stroke, "stop-opacity": "0.28" }));
  grad.appendChild(el("stop", { offset: "100%", "stop-color": stroke, "stop-opacity": "0" }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  // Horizontal gridlines with price labels on the right.
  for (const t of niceTicks(yMin, yMax)) {
    const gy = y(t);
    svg.appendChild(
      el("line", { x1: pad.left, y1: gy, x2: pad.left + plotW, y2: gy, class: "grid" })
    );
    const label = el("text", { x: W - pad.right + 8, y: gy + 4, class: "axis-label" });
    label.textContent = fmtPrice(t);
    svg.appendChild(label);
  }

  const linePath = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.close)}`).join(" ");
  const areaPath =
    `${linePath} L${x(points.length - 1)},${pad.top + plotH} L${x(0)},${pad.top + plotH} Z`;

  svg.appendChild(el("path", { d: areaPath, fill: `url(#${gradId})`, stroke: "none" }));
  svg.appendChild(
    el("path", {
      d: linePath,
      fill: "none",
      stroke,
      "stroke-width": "2",
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
      "vector-effect": "non-scaling-stroke",
    })
  );

  // Date labels at each end.
  const first = el("text", { x: pad.left, y: H - 8, class: "axis-label" });
  first.textContent = fmtDate(points[0].date).slice(0, 6);
  svg.appendChild(first);

  const last = el("text", {
    x: pad.left + plotW,
    y: H - 8,
    class: "axis-label",
    "text-anchor": "end",
  });
  last.textContent = fmtDate(points[points.length - 1].date).slice(0, 6);
  svg.appendChild(last);

  // Hover crosshair.
  const hoverLine = el("line", { class: "hover-line", y1: pad.top, y2: pad.top + plotH, opacity: "0" });
  const hoverDot = el("circle", { r: "4", fill: stroke, stroke: "var(--surface)", "stroke-width": "2", opacity: "0" });
  svg.appendChild(hoverLine);
  svg.appendChild(hoverDot);

  const hit = el("rect", {
    x: pad.left, y: pad.top, width: plotW, height: plotH,
    fill: "transparent", style: "cursor:crosshair",
  });
  svg.appendChild(hit);

  mount.appendChild(svg);

  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  mount.appendChild(tip);

  function locate(evt) {
    const box = svg.getBoundingClientRect();
    const cx = evt.touches ? evt.touches[0].clientX : evt.clientX;
    // Map screen position back into viewBox coordinates.
    const vx = ((cx - box.left) / box.width) * W;
    const ratio = (vx - pad.left) / plotW;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    const p = points[i];

    hoverLine.setAttribute("x1", x(i));
    hoverLine.setAttribute("x2", x(i));
    hoverLine.setAttribute("opacity", "1");
    hoverDot.setAttribute("cx", x(i));
    hoverDot.setAttribute("cy", y(p.close));
    hoverDot.setAttribute("opacity", "1");

    tip.hidden = false;
    tip.innerHTML = `<b>₹${fmtPrice(p.close)}</b><span>${fmtDate(p.date)}</span>`;
    // Keep the tooltip inside the card at both edges.
    const left = (x(i) / W) * box.width;
    tip.style.left = Math.max(4, Math.min(box.width - tip.offsetWidth - 4, left - tip.offsetWidth / 2)) + "px";
  }

  function clear() {
    hoverLine.setAttribute("opacity", "0");
    hoverDot.setAttribute("opacity", "0");
    tip.hidden = true;
  }

  hit.addEventListener("mousemove", locate);
  hit.addEventListener("mouseleave", clear);
  hit.addEventListener("touchstart", (e) => { locate(e); }, { passive: true });
  hit.addEventListener("touchmove", (e) => { locate(e); }, { passive: true });
  hit.addEventListener("touchend", clear);
}
