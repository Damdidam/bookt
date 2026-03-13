/**
 * SLOT OPTIMIZER — dynamic granularity + smart ranking for the slot engine.
 *
 * 1. computeOptimalGranularity(durations) — GCD-based step from service durations
 * 2. rankSlots(slots, bookingMap) — score slots by gap-filling potential
 * 3. calibrateAllBusinesses(queryFn) — nightly cron to refine granularity from booking history
 */

// ── GCD helpers ──

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

function gcdArray(arr) {
  return arr.reduce((g, v) => gcd(g, v));
}

/**
 * Compute optimal slot granularity from an array of service durations.
 * @param {number[]} durations — all active service durations in minutes
 * @returns {number} granularity in minutes, clamped [5, 30]
 */
function computeOptimalGranularity(durations) {
  if (!durations || durations.length === 0) return 15; // fallback

  // Filter out invalid values
  const valid = durations.filter(d => d > 0);
  if (valid.length === 0) return 15;

  let g = gcdArray(valid);

  // If GCD > 30, halve until reasonable
  while (g > 30) g = Math.floor(g / 2);

  // Clamp minimum to 5
  return Math.max(g, 5);
}

// ── Smart slot ranking ──

/**
 * Score and sort slots by gap-filling potential.
 * Mutates the slots array in-place (adds _score, re-sorts).
 *
 * @param {object[]} slots — flat array of slot objects from the engine
 * @param {object} bookingMap — { "pracId-date": [{ start, end, ... }] }
 */
function rankSlots(slots, bookingMap) {
  if (!slots || slots.length === 0) return;

  for (const slot of slots) {
    let score = 5; // base score for any valid slot
    const key = `${slot.practitioner_id}-${slot.date}`;
    const dayBookings = bookingMap[key];

    if (dayBookings && dayBookings.length > 0) {
      const slotStartMs = new Date(slot.start_at).getTime();
      const slotEndMs = new Date(slot.end_at).getTime();

      let adjacentBefore = false; // slot starts right after a booking ends
      let adjacentAfter = false;  // slot ends right before a booking starts
      let prevEnd = null;
      let nextStart = null;

      for (const bk of dayBookings) {
        const bkStartMs = new Date(bk.start).getTime();
        const bkEndMs = new Date(bk.end).getTime();

        // Adjacent after existing booking (slot starts where booking ends)
        if (Math.abs(slotStartMs - bkEndMs) < 60000) { // within 1 min tolerance
          adjacentBefore = true;
          score += 30;
        }

        // Adjacent before existing booking (slot ends where booking starts)
        if (Math.abs(slotEndMs - bkStartMs) < 60000) {
          adjacentAfter = true;
          score += 30;
        }

        // Track nearest boundaries for gap-fill detection
        if (bkEndMs <= slotStartMs && (!prevEnd || bkEndMs > prevEnd)) prevEnd = bkEndMs;
        if (bkStartMs >= slotEndMs && (!nextStart || bkStartMs < nextStart)) nextStart = bkStartMs;
      }

      // Perfect gap fill: slot touches both sides
      if (adjacentBefore && adjacentAfter) {
        score += 40; // bonus on top of the 2×30
      }
    }

    slot._score = score;
  }

  // Stable sort: by date asc, then score desc
  slots.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return b._score - a._score;
  });
}

// ── Nightly calibration cron ──

/**
 * For each active business, analyze booking history and compute
 * an optimized granularity weighted by service popularity.
 *
 * @param {Function} queryFn — the raw query function (not RLS-scoped)
 */
async function calibrateAllBusinesses(queryFn) {
  // Get all active businesses
  const bizResult = await queryFn(
    `SELECT id, settings FROM businesses WHERE is_active = true`
  );

  let calibrated = 0;

  for (const biz of bizResult.rows) {
    const settings = biz.settings || {};
    if (settings.slot_auto_optimize === false) continue;

    // Count bookings per service in last 60 days
    const statsResult = await queryFn(
      `SELECT b.service_id, s.duration_min, COUNT(*)::int AS cnt
       FROM bookings b
       JOIN services s ON s.id = b.service_id AND s.business_id = b.business_id
       WHERE b.business_id = $1
         AND b.created_at >= NOW() - INTERVAL '60 days'
         AND b.status IN ('confirmed', 'completed', 'no_show')
       GROUP BY b.service_id, s.duration_min
       ORDER BY cnt DESC`,
      [biz.id]
    );

    const rows = statsResult.rows;
    const totalBookings = rows.reduce((s, r) => s + r.cnt, 0);

    // Not enough data — skip, let PGCD fallback handle it
    if (totalBookings < 30) continue;

    // Take top services representing ~80% of booking volume
    let cumulative = 0;
    const topDurations = [];
    for (const r of rows) {
      topDurations.push(r.duration_min);
      cumulative += r.cnt;
      if (cumulative >= totalBookings * 0.8) break;
    }

    if (topDurations.length === 0) continue;

    const optGranularity = computeOptimalGranularity(topDurations);

    // Store in settings
    await queryFn(
      `UPDATE businesses
       SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('optimized_granularity', $1::int)
       WHERE id = $2`,
      [optGranularity, biz.id]
    );

    calibrated++;
  }

  if (calibrated > 0) {
    console.log(`Slot calibration: updated ${calibrated} business(es)`);
  }
}

module.exports = { gcd, computeOptimalGranularity, rankSlots, calibrateAllBusinesses };
