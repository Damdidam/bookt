const router = require('express').Router();
const { query, queryWithRLS } = require('../../services/db');
const { requireAuth, resolvePractitionerScope } = require('../../middleware/auth');

router.use(requireAuth);
router.use(resolvePractitionerScope);

// ============================================================
// GET /api/dashboard — basic business + practitioners
// Used by onboarding and dashboard shell
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const biz = await queryWithRLS(bid,
      `SELECT id, slug, name, plan, tagline FROM businesses WHERE id = $1`, [bid]
    );
    const pracs = await queryWithRLS(bid,
      `SELECT id, display_name, title, color, bio, years_experience
       FROM practitioners WHERE business_id = $1 ORDER BY sort_order, created_at`, [bid]
    );
    res.json({
      business: biz.rows[0],
      practitioners: pracs.rows
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/dashboard/summary
// Dashboard home: stats + today's bookings
// UI: Dashboard home page (7 RDV today, 6240€ CA, 47 clients, 78% appels→RDV)
// ============================================================
router.get('/summary', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const today = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Brussels' }).split(' ')[0];
    const monthStart = today.slice(0, 7) + '-01';

    // Today's bookings
    const pracFilter = req.practitionerFilter;
    const todayBookings = await queryWithRLS(bid,
      `SELECT b.id, b.practitioner_id, b.start_at, b.end_at, b.status, b.appointment_mode,
              b.internal_note,
              s.name AS service_name, s.duration_min,
              sv.name AS variant_name,
              p.display_name AS practitioner_name, p.color AS practitioner_color,
              c.full_name AS client_name,
              (SELECT COUNT(*) FROM practitioner_todos t WHERE t.booking_id = b.id AND t.is_done = false) AS todo_count,
              (SELECT COUNT(*) FROM booking_notes n WHERE n.booking_id = b.id) AS note_count
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN practitioners p ON p.id = b.practitioner_id
       LEFT JOIN clients c ON c.id = b.client_id
       WHERE b.business_id = $1
       AND DATE(b.start_at AT TIME ZONE 'Europe/Brussels') = $2
       AND b.status IN ('pending', 'confirmed', 'completed', 'pending_deposit')
       ${pracFilter ? 'AND b.practitioner_id = $3' : ''}
       ORDER BY b.start_at`,
      pracFilter ? [bid, today, pracFilter] : [bid, today]
    );

    // Stats: bookings this month
    const monthStats = await queryWithRLS(bid,
      `SELECT
        COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed')) AS total_bookings,
        COUNT(*) FILTER (WHERE status = 'no_show') AS no_shows,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancellations,
        COALESCE(SUM(
          COALESCE(b.booked_price_cents, sv.price_cents, s.price_cents, 0)
          - CASE WHEN b.group_order = 0 OR b.group_order IS NULL THEN COALESCE(b.promotion_discount_cents, 0) ELSE 0 END
        ) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0) AS revenue_cents
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       WHERE b.business_id = $1
       AND b.start_at >= $2
       ${pracFilter ? 'AND b.practitioner_id = $3' : ''}`,
      pracFilter ? [bid, monthStart, pracFilter] : [bid, monthStart]
    );

    // Active clients count
    const clientCount = await queryWithRLS(bid,
      pracFilter
        ? `SELECT COUNT(DISTINCT b.client_id) AS total FROM bookings b WHERE b.business_id = $1 AND b.practitioner_id = $2 AND b.status IN ('confirmed', 'completed')`
        : `SELECT COUNT(DISTINCT b.client_id) AS total FROM bookings b WHERE b.business_id = $1 AND b.status IN ('confirmed', 'completed')`,
      pracFilter ? [bid, pracFilter] : [bid]
    );

    // Next upcoming booking
    const nextBooking = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.status,
              s.name AS service_name, s.duration_min,
              p.display_name AS practitioner_name,
              c.full_name AS client_name
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       LEFT JOIN clients c ON c.id = b.client_id
       WHERE b.business_id = $1
       AND b.start_at > NOW()
       AND b.status IN ('pending', 'confirmed', 'pending_deposit')
       ${pracFilter ? 'AND b.practitioner_id = $2' : ''}
       ORDER BY b.start_at LIMIT 1`,
      pracFilter ? [bid, pracFilter] : [bid]
    );

    // Pending todos
    const pendingTodos = await queryWithRLS(bid,
      `SELECT t.id, t.content, t.booking_id, t.created_at,
              b.start_at AS booking_start, s.name AS service_name, c.full_name AS client_name
       FROM practitioner_todos t
       LEFT JOIN bookings b ON b.id = t.booking_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN clients c ON c.id = b.client_id
       WHERE t.business_id = $1 AND t.is_done = false
       ${pracFilter ? 'AND t.booking_id IN (SELECT id FROM bookings WHERE practitioner_id = $2 AND business_id = $1)' : ''}
       ORDER BY t.created_at DESC LIMIT 20`,
      pracFilter ? [bid, pracFilter] : [bid]
    );

    // ── Prac hours (computed from todayBookings already fetched) ──
    const pracHoursMap = {};
    todayBookings.rows.forEach(b => {
      const mins = (new Date(b.end_at) - new Date(b.start_at)) / 60000;
      if (mins > 0) {
        if (!pracHoursMap[b.practitioner_id]) {
          pracHoursMap[b.practitioner_id] = { name: b.practitioner_name, color: b.practitioner_color, minutes: 0 };
        }
        pracHoursMap[b.practitioner_id].minutes += mins;
      }
    });

    // ── Recent activity (bookings created in last 3 days) ──
    const recentActivity = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.status, b.channel, b.created_at,
              s.name AS service_name,
              p.display_name AS practitioner_name,
              c.full_name AS client_name
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       LEFT JOIN clients c ON c.id = b.client_id
       WHERE b.business_id = $1
       AND b.created_at >= NOW() - INTERVAL '3 days'
       ${pracFilter ? 'AND b.practitioner_id = $2' : ''}
       ORDER BY b.created_at DESC LIMIT 30`,
      pracFilter ? [bid, pracFilter] : [bid]
    );

    // ── Alerts ──
    const [pendingConf, unpaidDep, recentNoShows, upcomingAbsences] = await Promise.all([
      queryWithRLS(bid,
        `SELECT COUNT(*) AS count FROM bookings
         WHERE business_id = $1 AND status = 'pending'
         AND start_at > NOW() AND start_at < NOW() + INTERVAL '7 days'`, [bid]),
      queryWithRLS(bid,
        `SELECT COUNT(*) AS count FROM bookings
         WHERE business_id = $1 AND deposit_required = true
         AND deposit_status = 'pending' AND status NOT IN ('cancelled', 'no_show')`, [bid]),
      queryWithRLS(bid,
        `SELECT COUNT(*) AS count FROM bookings
         WHERE business_id = $1 AND status = 'no_show'
         AND start_at >= NOW() - INTERVAL '7 days'`, [bid]),
      queryWithRLS(bid,
        `SELECT a.date_from, a.date_to, a.type, p.display_name AS practitioner_name
         FROM staff_absences a
         JOIN practitioners p ON p.id = a.practitioner_id
         WHERE a.business_id = $1 AND a.date_to >= CURRENT_DATE
         AND a.date_from <= CURRENT_DATE + 7
         ORDER BY a.date_from LIMIT 5`, [bid])
    ]);

    // Weekly booking count for free tier bandeau
    const weekCountRes = await queryWithRLS(bid,
      `SELECT COUNT(*)::int AS cnt FROM bookings
       WHERE business_id = $1
         AND status IN ('confirmed', 'pending', 'pending_deposit', 'modified_pending')
         AND start_at >= date_trunc('week', NOW() AT TIME ZONE 'Europe/Brussels')
         AND start_at < date_trunc('week', NOW() AT TIME ZONE 'Europe/Brussels') + INTERVAL '1 week'`,
      [bid]);

    const stats = monthStats.rows[0];
    const nb = nextBooking.rows[0] || null;

    res.json({
      weekly_booking_count: weekCountRes.rows[0].cnt,
      today: {
        date: today,
        bookings: todayBookings.rows.map(b => ({
          id: b.id,
          start_at: b.start_at,
          end_at: b.end_at,
          status: b.status,
          appointment_mode: b.appointment_mode,
          service_name: b.service_name,
          duration_min: b.duration_min,
          practitioner_name: b.practitioner_name,
          practitioner_color: b.practitioner_color,
          client_name: b.client_name,
          todo_count: parseInt(b.todo_count) || 0,
          note_count: parseInt(b.note_count) || 0,
          has_internal_note: !!b.internal_note
        })),
        count: todayBookings.rows.length
      },
      month: {
        total_bookings: parseInt(stats.total_bookings),
        no_shows: parseInt(stats.no_shows),
        cancellations: parseInt(stats.cancellations),
        revenue_cents: parseInt(stats.revenue_cents),
        revenue_formatted: `${(parseInt(stats.revenue_cents) / 100).toFixed(2).replace('.', ',')} €`
      },
      clients: {
        total: parseInt(clientCount.rows[0].total)
      },
      next_booking: nb ? { id: nb.id, start_at: nb.start_at, status: nb.status, client_name: nb.client_name, service_name: nb.service_name, duration_min: nb.duration_min, practitioner_name: nb.practitioner_name } : null,
      pending_todos: pendingTodos.rows.map(t => ({ id: t.id, content: t.content, booking_id: t.booking_id, created_at: t.created_at, booking_start: t.booking_start, service_name: t.service_name, client_name: t.client_name })),
      prac_hours: Object.entries(pracHoursMap).map(([id, h]) => ({
        id, name: h.name, color: h.color, minutes: h.minutes,
        formatted: Math.floor(h.minutes / 60) + 'h' + (h.minutes % 60 > 0 ? String(Math.round(h.minutes % 60)).padStart(2, '0') : '')
      })),
      recent_activity: recentActivity.rows.map(r => ({
        id: r.id, start_at: r.start_at, status: r.status, channel: r.channel || 'manual',
        created_at: r.created_at, service_name: r.service_name,
        practitioner_name: r.practitioner_name, client_name: r.client_name
      })),
      alerts: {
        pending_confirmations: parseInt(pendingConf.rows[0].count),
        unpaid_deposits: parseInt(unpaidDep.rows[0].count),
        recent_no_shows: parseInt(recentNoShows.rows[0].count),
        upcoming_absences: upcomingAbsences.rows.map(a => ({
          date_from: a.date_from, date_to: a.date_to, type: a.type, practitioner_name: a.practitioner_name
        }))
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/dashboard/analytics
// Full analytics: revenue/bookings trends, peak hours, top services, status breakdown
// UI: Dashboard > Analytics section (Pro feature)
// V11-020: TODO — These analytics queries are heavy (7 queries per request).
// Consider adding server-side caching (e.g., Redis or in-memory with TTL of 5-10 min)
// or materialized views for larger businesses.
// ============================================================
router.get('/analytics', async (req, res, next) => {
  try {
    const bid = req.businessId;

    // Plan guard: analytics restricted to paid plans
    const bizPlanA = await queryWithRLS(bid,
      `SELECT plan FROM businesses WHERE id = $1`, [bid]);
    if (bizPlanA.rows[0]?.plan === 'free') {
      return res.status(403).json({ error: 'upgrade_required', message: 'Les statistiques avancées sont disponibles avec le plan Pro.' });
    }

    const { period } = req.query; // '30d' (default), '7d', '90d'
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString().split('T')[0];
    const pracFilter = req.practitionerFilter;

    // 1. Revenue + bookings by day
    const dailyStats = await queryWithRLS(bid,
      `SELECT
        DATE(b.start_at AT TIME ZONE 'Europe/Brussels') AS day,
        COUNT(*) FILTER (WHERE b.status IN ('confirmed', 'completed')) AS bookings,
        COUNT(*) FILTER (WHERE b.status = 'no_show') AS no_shows,
        COUNT(*) FILTER (WHERE b.status = 'cancelled') AS cancellations,
        COALESCE(SUM(
          COALESCE(b.booked_price_cents, sv.price_cents, s.price_cents, 0)
          - CASE WHEN b.group_order = 0 OR b.group_order IS NULL THEN COALESCE(b.promotion_discount_cents, 0) ELSE 0 END
        ) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0) AS revenue
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       WHERE b.business_id = $1 AND b.start_at >= $2
       ${pracFilter ? 'AND b.practitioner_id = $3' : ''}
       GROUP BY day ORDER BY day`,
      pracFilter ? [bid, startStr, pracFilter] : [bid, startStr]
    );

    // 2. Peak hours heatmap (weekday 0-6 x hour 0-23)
    const peakHours = await queryWithRLS(bid,
      `SELECT
        EXTRACT(DOW FROM b.start_at AT TIME ZONE 'Europe/Brussels')::int AS weekday,
        EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'Europe/Brussels')::int AS hour,
        COUNT(*) AS count
       FROM bookings b
       WHERE b.business_id = $1
       AND b.status IN ('confirmed', 'completed')
       AND b.start_at >= $2
       ${pracFilter ? 'AND b.practitioner_id = $3' : ''}
       GROUP BY weekday, hour ORDER BY weekday, hour`,
      pracFilter ? [bid, startStr, pracFilter] : [bid, startStr]
    );

    // 3. Top services
    const topServices = await queryWithRLS(bid,
      `SELECT s.name, s.color, COUNT(b.id) AS count,
        COALESCE(SUM(
          COALESCE(b.booked_price_cents, sv.price_cents, s.price_cents, 0)
          - CASE WHEN b.group_order = 0 OR b.group_order IS NULL THEN COALESCE(b.promotion_discount_cents, 0) ELSE 0 END
        ), 0) AS revenue
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       WHERE b.business_id = $1
       AND b.status IN ('confirmed', 'completed')
       AND b.start_at >= $2
       ${pracFilter ? 'AND b.practitioner_id = $3' : ''}
       GROUP BY s.id, s.name, s.color
       ORDER BY count DESC LIMIT 10`,
      pracFilter ? [bid, startStr, pracFilter] : [bid, startStr]
    );

    // 4. Status breakdown
    const statusBreakdown = await queryWithRLS(bid,
      `SELECT b.status, COUNT(*) AS count
       FROM bookings b
       WHERE b.business_id = $1 AND b.start_at >= $2
       ${pracFilter ? 'AND b.practitioner_id = $3' : ''}
       GROUP BY b.status`,
      pracFilter ? [bid, startStr, pracFilter] : [bid, startStr]
    );

    // 5. Monthly revenue (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthlyRevenue = await queryWithRLS(bid,
      `SELECT
        TO_CHAR(b.start_at AT TIME ZONE 'Europe/Brussels', 'YYYY-MM') AS month,
        COUNT(*) FILTER (WHERE b.status IN ('confirmed', 'completed')) AS bookings,
        COALESCE(SUM(
          COALESCE(b.booked_price_cents, sv.price_cents, s.price_cents, 0)
          - CASE WHEN b.group_order = 0 OR b.group_order IS NULL THEN COALESCE(b.promotion_discount_cents, 0) ELSE 0 END
        ) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0) AS revenue
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       WHERE b.business_id = $1 AND b.start_at >= $2
       ${pracFilter ? 'AND b.practitioner_id = $3' : ''}
       GROUP BY month ORDER BY month`,
      pracFilter ? [bid, sixMonthsAgo.toISOString(), pracFilter] : [bid, sixMonthsAgo.toISOString()]
    );

    // 6. New clients this period
    const newClients = await queryWithRLS(bid,
      `SELECT COUNT(*) AS count FROM clients
       WHERE business_id = $1 AND created_at >= $2`,
      [bid, startStr]
    );

    // 7. Totals for the period
    const totals = dailyStats.rows.reduce((acc, d) => {
      acc.bookings += parseInt(d.bookings);
      acc.revenue += parseInt(d.revenue);
      acc.no_shows += parseInt(d.no_shows);
      acc.cancellations += parseInt(d.cancellations);
      return acc;
    }, { bookings: 0, revenue: 0, no_shows: 0, cancellations: 0 });

    totals.avg_booking_value = totals.bookings > 0
      ? Math.round(totals.revenue / totals.bookings) : 0;
    totals.no_show_rate = (totals.bookings + totals.no_shows) > 0
      ? Math.round(totals.no_shows / (totals.bookings + totals.no_shows) * 100) : 0;

    res.json({
      period: { days, start: startStr },
      totals,
      daily: dailyStats.rows.map(r => ({
        day: r.day, bookings: parseInt(r.bookings),
        no_shows: parseInt(r.no_shows), cancellations: parseInt(r.cancellations),
        revenue: parseInt(r.revenue)
      })),
      peak_hours: peakHours.rows.map(r => ({
        weekday: r.weekday, hour: r.hour, count: parseInt(r.count)
      })),
      top_services: topServices.rows.map(r => ({
        name: r.name, color: r.color, count: parseInt(r.count),
        revenue: parseInt(r.revenue)
      })),
      status_breakdown: statusBreakdown.rows.map(r => ({
        status: r.status, count: parseInt(r.count)
      })),
      monthly: monthlyRevenue.rows.map(r => ({
        month: r.month, bookings: parseInt(r.bookings),
        revenue: parseInt(r.revenue)
      })),
      new_clients: parseInt(newClients.rows[0].count)
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/dashboard/announcements — active system announcements
// ============================================================
router.get('/announcements', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, body, type, starts_at, ends_at
       FROM system_announcements
       WHERE is_active = true
         AND starts_at <= NOW()
         AND (ends_at IS NULL OR ends_at > NOW())
       ORDER BY type = 'maintenance' DESC, starts_at DESC
       LIMIT 5`
    );
    res.json({ announcements: result.rows });
  } catch (err) { next(err); }
});

module.exports = router;
