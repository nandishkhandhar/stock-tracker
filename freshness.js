// ---------------------------------------------------------------------------
// Cache freshness
// ---------------------------------------------------------------------------
// The only reason to spend a request is that a NEWER daily close exists than
// the one already cached. Indian markets close at 15:30 IST, Mon-Fri, so the
// most recent close is determined by the clock and the calendar — never by how
// many minutes ago the cache was written.

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const CLOSE_MINUTES = 15 * 60 + 30; // 15:30 IST

/** Current wall-clock time in IST, as a Date whose UTC fields read as IST. */
function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * The date of the most recent session whose close has been published.
 * Before 15:30 IST today, that is the previous trading day; after, it is today
 * (weekends roll back to Friday).
 *
 * Exchange holidays are not modelled: on a holiday this returns that date, the
 * API returns the prior session's data, and the cache simply holds one extra
 * day. That costs at most one wasted request, which is cheaper than shipping a
 * holiday calendar that silently goes out of date.
 */
export function lastPublishedClose(now = nowIST()) {
  const d = new Date(now.getTime());
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();

  if (minutes < CLOSE_MINUTES) d.setUTCDate(d.getUTCDate() - 1);

  // 0 = Sunday, 6 = Saturday
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return ymd(d);
}

/**
 * Cached data is fresh when the close it holds is already the latest published
 * one. Reopening the page any number of times in a day therefore costs nothing.
 */
export function isCacheFresh(entry) {
  if (!entry?.data?.latest?.date) return false;
  return entry.data.latest.date >= lastPublishedClose();
}
