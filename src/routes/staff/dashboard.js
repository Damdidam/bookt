const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth } = require('../../middleware/auth');

router.use(requireAuth);

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
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';

    // Today's bookings
    const todayBookings = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.end_at, b.status, b.appointment_mode,
              s.name AS service_name, s.duration_min,
              p.display_name AS practitioner_name,
              c.full_name AS client_name
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN clients c ON c.id = b.client_id
       WHERE b.business_id = $1
       AND DATE(b.start_at AT TIME ZONE 'Europe/Brussels') = $2
       AND b.status IN ('pending', 'confirmed', 'completed')
       ORDER BY b.start_at`,
      [bid, today]
    );

    // Stats: bookings this month
    const monthStats = await queryWithRLS(bid,
      `SELECT
        COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed')) AS total_bookings,
        COUNT(*) FILTER (WHERE status = 'no_show') AS no_shows,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancellations,
        COALESCE(SUM(s.price_cents) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0) AS revenue_cents
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE b.business_id = $1
       AND b.start_at >= $2`,
      [bid, monthStart]
    );

    // Active clients count
    const clientCount = await queryWithRLS(bid,
      `SELECT COUNT(*) AS total FROM clients WHERE business_id = $1`,
      [bid]
    );

    // Call stats this month (if module active)
    const callStats = await queryWithRLS(bid,
      `SELECT
        COUNT(*) AS total_calls,
        COUNT(*) FILTER (WHERE action = 'sent_sms') AS filtered,
        COUNT(*) FILTER (WHERE action = 'whitelist_pass') AS vip_passed,
        COUNT(*) FILTER (WHERE action = 'urgent_key') AS urgent,
        COUNT(*) FILTER (WHERE booking_id IS NOT NULL) AS converted
       FROM call_logs
       WHERE business_id = $1
       AND created_at >= $2`,
      [bid, monthStart]
    );

    // Call filter status
    const filterStatus = await queryWithRLS(bid,
      `SELECT filter_mode, twilio_number FROM call_settings WHERE business_id = $1`,
      [bid]
    );

    const stats = monthStats.rows[0];
    const calls = callStats.rows[0];

    res.json({
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
          client_name: b.client_name
        })),
        count: todayBookings.rows.length
      },
      month: {
        total_bookings: parseInt(stats.total_bookings),
        no_shows: parseInt(stats.no_shows),
        cancellations: parseInt(stats.cancellations),
        revenue_cents: parseInt(stats.revenue_cents),
        revenue_formatted: `${(parseInt(stats.revenue_cents) / 100).toFixed(0)} €`
      },
      clients: {
        total: parseInt(clientCount.rows[0].total)
      },
      calls: {
        total: parseInt(calls.total_calls),
        filtered: parseInt(calls.filtered),
        vip_passed: parseInt(calls.vip_passed),
        urgent: parseInt(calls.urgent),
        converted: parseInt(calls.converted),
        conversion_rate: calls.filtered > 0
          ? Math.round((parseInt(calls.converted) / parseInt(calls.filtered)) * 100)
          : 0
      },
      call_filter: filterStatus.rows.length > 0
        ? { active: filterStatus.rows[0].filter_mode !== 'off', mode: filterStatus.rows[0].filter_mode, number: filterStatus.rows[0].twilio_number }
        : { active: false }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/dashboard/analytics
// Full analytics: revenue/bookings trends, peak hours, top services, status breakdown
// UI: Dashboard > Analytics section (Pro feature)
// ============================================================
router.get('/analytics', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { period } = req.query; // '30d' (default), '7d', '90d'
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString().split('T')[0];

    // 1. Revenue + bookings by day
    const dailyStats = await queryWithRLS(bid,
      `SELECT
        DATE(b.start_at AT TIME ZONE 'Europe/Brussels') AS day,
        COUNT(*) FILTER (WHERE b.status IN ('confirmed', 'completed')) AS bookings,
        COUNT(*) FILTER (WHERE b.status = 'no_show') AS no_shows,
        COUNT(*) FILTER (WHERE b.status = 'cancelled') AS cancellations,
        COALESCE(SUM(s.price_cents) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0) AS revenue
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE b.business_id = $1 AND b.start_at >= $2
       GROUP BY day ORDER BY day`,
      [bid, startStr]
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
       GROUP BY weekday, hour ORDER BY weekday, hour`,
      [bid, startStr]
    );

    // 3. Top services
    const topServices = await queryWithRLS(bid,
      `SELECT s.name, s.color, COUNT(b.id) AS count,
        COALESCE(SUM(s.price_cents), 0) AS revenue
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE b.business_id = $1
       AND b.status IN ('confirmed', 'completed')
       AND b.start_at >= $2
       GROUP BY s.id, s.name, s.color
       ORDER BY count DESC LIMIT 10`,
      [bid, startStr]
    );

    // 4. Status breakdown
    const statusBreakdown = await queryWithRLS(bid,
      `SELECT b.status, COUNT(*) AS count
       FROM bookings b
       WHERE b.business_id = $1 AND b.start_at >= $2
       GROUP BY b.status`,
      [bid, startStr]
    );

    // 5. Monthly revenue (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthlyRevenue = await queryWithRLS(bid,
      `SELECT
        TO_CHAR(b.start_at AT TIME ZONE 'Europe/Brussels', 'YYYY-MM') AS month,
        COUNT(*) FILTER (WHERE b.status IN ('confirmed', 'completed')) AS bookings,
        COALESCE(SUM(s.price_cents) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0) AS revenue
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE b.business_id = $1 AND b.start_at >= $2
       GROUP BY month ORDER BY month`,
      [bid, sixMonthsAgo.toISOString()]
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

module.exports = router;
