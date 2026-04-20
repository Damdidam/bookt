/**
 * Booking Time — move, edit, resize, modify (time changes + notifications).
 */
const router = require('express').Router();
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { broadcast } = require('../../services/sse');
const { sendModificationEmail } = require('../../services/email');
const { sendSMS } = require('../../services/sms');
const { calSyncPush, businessAllowsOverlap, checkPracAvailability, getMaxConcurrent, checkBookingConflicts, syncDraftInvoicesForBookings } = require('./bookings-helpers');
const { isWithinLastMinuteWindow, invalidateMinisiteCache } = require('../public/helpers');

// STS-V12-007: UUID validation regex (reused across all endpoints)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lock = vrai verrou (actif depuis commit 127628b — locked=true auto après
 * paiement d'acompte confirmé). Bloque move/edit/resize/modify côté staff
 * tant que le cadenas n'est pas retiré manuellement via la fiche booking.
 * Le drag&drop calendar reçoit un 400 avec le reason ci-dessous.
 */
function isBookingLocked(booking) {
  if (booking.locked) return { locked: true, reason: 'RDV verrouillé — déverrouillez-le d\'abord via la fiche' };
  return { locked: false };
}

// ============================================================
// GET /api/bookings/:id/check-slot — Pre-flight slot availability
// UI: Calendar → detail modal → time inputs (debounced 500ms)
// ============================================================
router.get('/:id/check-slot', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });

    const { start_at, end_at, practitioner_id } = req.query;
    if (!start_at || !end_at) return res.status(400).json({ error: 'start_at et end_at requis' });
    if (isNaN(new Date(start_at).getTime()) || isNaN(new Date(end_at).getTime())) return res.status(400).json({ error: 'Format invalide' });

    // If overlaps allowed globally, always available
    const globalAllowOverlap = await businessAllowsOverlap(bid);
    if (globalAllowOverlap) return res.json({ available: true });

    // Fetch booking for default practitioner + group + processing info
    const bk = await queryWithRLS(bid,
      `SELECT b.practitioner_id, b.group_id, b.processing_time, b.processing_start,
              COALESCE(s.buffer_before_min, 0) AS buffer_before
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id = $1 AND b.business_id = $2`, [id, bid]);
    if (bk.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const b = bk.rows[0];
    const pracId = practitioner_id || b.practitioner_id;
    const maxConcurrent = await getMaxConcurrent(bid, pracId);

    // Exclude this booking + group siblings
    let excludeIds = [id];
    if (b.group_id) {
      const sibs = await queryWithRLS(bid, `SELECT id FROM bookings WHERE group_id = $1 AND business_id = $2`, [b.group_id, bid]);
      excludeIds = sibs.rows.map(r => r.id);
    }

    // Build conflict query (read-only, no FOR UPDATE)
    const params = [bid, pracId, start_at, end_at, excludeIds];
    let reversePoseClause = '';
    const pt = parseInt(b.processing_time) || 0;
    if (pt > 0) {
      params.push(parseInt(b.buffer_before) || 0, parseInt(b.processing_start) || 0, pt);
      reversePoseClause = `AND NOT (
        date_trunc('minute', b.start_at) >= date_trunc('minute', $3::timestamptz) + ($6::integer + $7::integer) * interval '1 minute'
        AND date_trunc('minute', b.end_at) <= date_trunc('minute', $3::timestamptz) + ($6::integer + $7::integer + $8::integer) * interval '1 minute'
      )`;
    }

    const conflicts = await queryWithRLS(bid,
      `SELECT b.id, s.name AS service_name, b.start_at, b.end_at
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id
       WHERE b.business_id = $1 AND b.practitioner_id = $2
       AND b.status IN ('pending','confirmed','modified_pending','pending_deposit')
       AND b.start_at < $4 AND b.end_at > $3
       AND b.id != ALL($5::uuid[])
       AND NOT (b.processing_time > 0
         AND date_trunc('minute', $3::timestamptz) >= date_trunc('minute', b.start_at) + (COALESCE(s.buffer_before_min,0) + b.processing_start) * interval '1 minute'
         AND date_trunc('minute', $4::timestamptz) <= date_trunc('minute', b.start_at) + (COALESCE(s.buffer_before_min,0) + b.processing_start + b.processing_time) * interval '1 minute')
       ${reversePoseClause}`, params);

    if (conflicts.rows.length >= maxConcurrent) {
      return res.json({ available: false, conflicts: conflicts.rows.map(c => ({
        id: c.id, service_name: c.service_name, start_at: c.start_at, end_at: c.end_at
      }))});
    }
    res.json({ available: true });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/bookings/:id/move — Drag & drop
// UI: Calendar → drag event to new time/date/practitioner
// ============================================================
router.patch('/:id/move', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    // STS-V12-007: UUID validation
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { start_at, end_at, practitioner_id, notify, notify_channel, old_start_at, old_end_at } = req.body;
    const shouldNotify = notify === true || notify === 'true';
    const effectiveChannel = notify_channel || (shouldNotify ? 'email' : null);

    if (!start_at || !end_at) {
      return res.status(400).json({ error: 'start_at et end_at requis' });
    }
    if (isNaN(new Date(start_at).getTime()) || isNaN(new Date(end_at).getTime())) {
      return res.status(400).json({ error: 'Format de date invalide' });
    }
    if (new Date(start_at) >= new Date(end_at)) {
      return res.status(400).json({ error: 'L\'heure de fin doit être après l\'heure de début' });
    }
    // Reject moves too far in the past (2h tolerance)
    if (new Date(start_at).getTime() < Date.now() - 2 * 3600000) {
      return res.status(400).json({ error: 'Impossible de déplacer un rendez-vous aussi loin dans le passé' });
    }

    // CRT-8: Validate practitioner_id belongs to this business and is active
    if (practitioner_id) {
      const pracCheck = await queryWithRLS(bid, `SELECT id FROM practitioners WHERE id = $1 AND business_id = $2 AND is_active = true`, [practitioner_id, bid]);
      if (pracCheck.rows.length === 0) return res.status(400).json({ error: 'Praticien introuvable ou inactif' });
    }

    // Fetch dragged booking + service info + group info
    const old = await queryWithRLS(bid,
      `SELECT b.start_at, b.end_at, b.practitioner_id, b.service_id,
              b.group_id, b.group_order, b.status, b.locked,
              b.processing_time, b.processing_start,
              b.created_at, b.deposit_required,
              s.duration_min, s.buffer_before_min, s.buffer_after_min
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (old.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Guard: immutable statuses cannot be moved
    const IMMUTABLE = ['cancelled', 'completed', 'no_show'];
    if (IMMUTABLE.includes(old.rows[0].status)) {
      return res.status(400).json({ error: 'Ce RDV ne peut plus être modifié' });
    }
    const lockCheck = isBookingLocked(old.rows[0]);
    if (lockCheck.locked) {
      return res.status(400).json({ error: lockCheck.reason });
    }

    const draggedBooking = old.rows[0];

    // CRT-11: Prevent practitioners from reassigning bookings to OTHER practitioners
    // Self-reassignment (same practitioner_id) is allowed for time-only moves
    if (practitioner_id && req.user.role === 'practitioner' && String(practitioner_id) !== String(draggedBooking.practitioner_id)) {
      return res.status(403).json({ error: 'Vous ne pouvez pas réaffecter un RDV à un autre praticien' });
    }

    // Practitioner scope: can only move own bookings
    if (req.practitionerFilter && String(draggedBooking.practitioner_id) !== String(req.practitionerFilter)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    const effectivePracId = practitioner_id || draggedBooking.practitioner_id;
    const newStart = new Date(start_at);

    const globalAllowOverlap = await businessAllowsOverlap(bid);
    const maxConcurrent = globalAllowOverlap ? Infinity : await getMaxConcurrent(bid, effectivePracId);

    // ── GROUP MOVE: recalculate all slots from the first booking's new start ──
    if (draggedBooking.group_id) {
      // Fetch all group members with their service/variant durations, ordered
      const groupRes = await queryWithRLS(bid,
        `SELECT b.id, b.start_at, b.end_at, b.group_order, b.practitioner_id,
                COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                s.buffer_before_min, s.buffer_after_min
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
         WHERE b.group_id = $1 AND b.business_id = $2
         ORDER BY b.group_order`,
        [draggedBooking.group_id, bid]
      );
      const groupMembers = groupRes.rows;
      if (groupMembers.length === 0) {
        return res.status(400).json({ error: 'Aucun membre trouvé dans le groupe' });
      }

      // Detect split group (different practitioners) — don't reassign practitioners on move
      const groupPracIds = new Set(groupMembers.map(m => m.practitioner_id));
      const isSplitGroup = groupPracIds.size > 1;

      // Calculate time delta from dragged booking's original start
      const delta = newStart.getTime() - new Date(draggedBooking.start_at).getTime();

      // Recalculate all slots: chain sequentially from the shifted first booking
      const firstOrigStart = new Date(groupMembers[0].start_at);
      let cursor = new Date(firstOrigStart.getTime() + delta);
      const updates = groupMembers.map((m, i) => {
        // Freestyle members have no service → preserve original duration
        const origDur = (new Date(m.end_at).getTime() - new Date(m.start_at).getTime()) / 60000;
        // BK-V13-001: Only apply buffer_before to first member and buffer_after to last member
        const totalMin = m.duration_min != null
          ? ((i === 0) ? (m.buffer_before_min || 0) : 0) + m.duration_min + ((i === groupMembers.length - 1) ? (m.buffer_after_min || 0) : 0)
          : origDur;
        const s = new Date(cursor);
        const e = new Date(s.getTime() + totalMin * 60000);
        cursor = e;
        return { id: m.id, start_at: s.toISOString(), end_at: e.toISOString(), practitioner_id: m.practitioner_id };
      });

      const totalStart = updates[0].start_at;
      const totalEnd = updates[updates.length - 1].end_at;

      // Check practitioner availability (absences, exceptions, hours)
      if (isSplitGroup) {
        // Split group: check each practitioner for their own time range
        for (const u of updates) {
          const availCheck = await checkPracAvailability(bid, u.practitioner_id, u.start_at, u.end_at);
          if (!availCheck.ok) {
            return res.status(409).json({ error: availCheck.reason });
          }
        }
      } else {
        const availCheck = await checkPracAvailability(bid, effectivePracId, totalStart, totalEnd);
        if (!availCheck.ok) {
          return res.status(409).json({ error: availCheck.reason });
        }
      }

      // Atomic group move: conflict check + updates in one transaction
      try {
        await transactionWithRLS(bid, async (client) => {
          // Bug H8 fix: Lock ALL group members, not just the dragged booking
          const groupLock = await client.query(
            `SELECT id, status FROM bookings
             WHERE group_id = $1 AND business_id = $2 FOR UPDATE`,
            [draggedBooking.group_id, bid]
          );
          const IMMUTABLE = ['cancelled', 'completed', 'no_show'];
          const immutableMember = groupLock.rows.find(r => IMMUTABLE.includes(r.status));
          if (groupLock.rows.length === 0 || immutableMember) {
            throw Object.assign(new Error('Un membre du groupe ne peut plus être modifié'), { type: 'immutable' });
          }

          // CRT-10: Check conflicts for ALL distinct practitioner IDs in the group, not just effectivePracId
          // STS-V12-005 fix: For each practitioner, compute their specific time range from their members
          // only, rather than using the full group totalStart/totalEnd which over-reports conflicts
          if (!globalAllowOverlap) {
            const groupIds = groupMembers.map(m => m.id);
            // For split groups, use each member's own practitioner_id; for non-split, use the target practitioner_id
            const distinctPracIds = [...new Set(updates.map(u => (isSplitGroup ? u.practitioner_id : (practitioner_id || u.practitioner_id))))];
            for (const pracId of distinctPracIds) {
              // Filter updates belonging to this practitioner and compute their min start / max end
              const pracUpdates = updates.filter(u => (isSplitGroup ? u.practitioner_id : (practitioner_id || u.practitioner_id)) === pracId);
              const pracStart = pracUpdates.reduce((min, u) => u.start_at < min ? u.start_at : min, pracUpdates[0].start_at);
              const pracEnd = pracUpdates.reduce((max, u) => u.end_at > max ? u.end_at : max, pracUpdates[0].end_at);
              const pracMaxConcurrent = await getMaxConcurrent(bid, pracId);
              const conflicts = await checkBookingConflicts(client, { bid, pracId, newStart: pracStart, newEnd: pracEnd, excludeIds: groupIds });
              if (conflicts.length >= pracMaxConcurrent) {
                throw Object.assign(new Error('Capacité maximale atteinte — impossible de déplacer le groupe ici'), { type: 'conflict' });
              }
            }
          }

          for (const u of updates) {
            // BUG-MOVE-CONFEXP fix: if the booking was 'pending' (awaiting client confirmation),
// the original confirmation_expires_at was set at creation — moving to a far-future
// date leaves the deadline in place, so the cron would auto-cancel shortly after.
// Reset to NULL so the cron only acts on start_at.
let sql = `UPDATE bookings SET start_at = $1, end_at = $2, reminder_24h_sent_at = NULL, reminder_2h_sent_at = NULL, confirmation_expires_at = CASE WHEN status = 'pending' THEN NULL ELSE confirmation_expires_at END, updated_at = NOW()`;
            const params = [u.start_at, u.end_at];
            let idx = 3;
            // Only reassign practitioner if NOT a split group (split = each member keeps its own practitioner)
            if (practitioner_id && !isSplitGroup) {
              sql += `, practitioner_id = $${idx}`;
              params.push(practitioner_id);
              idx++;
            }
            sql += ` WHERE id = $${idx} AND business_id = $${idx + 1} AND status NOT IN ('cancelled', 'completed', 'no_show')`;
            params.push(u.id, bid);
            await client.query(sql, params);
          }

          // M5 fix: Recalculate deposit deadlines using computeDepositDeadline (fresh calc, not delta shift)
          {
            const { computeDepositDeadline } = require('../../routes/public/helpers');
            const _depBizRes = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [bid]);
            const _depBizSettings = _depBizRes.rows[0]?.settings || {};
            for (const u of updates) {
              const memberInfo = await client.query(
                `SELECT deposit_required, deposit_deadline, deposit_status, start_at FROM bookings WHERE id = $1 AND business_id = $2`,
                [u.id, bid]
              );
              const mi = memberInfo.rows[0];
              if (mi?.deposit_required && mi.deposit_deadline && mi.deposit_status === 'pending') {
                const newDeadline = computeDepositDeadline(new Date(mi.start_at), _depBizSettings, mi.deposit_deadline);
                await client.query(
                  `UPDATE bookings SET deposit_deadline = $1 WHERE id = $2 AND business_id = $3`,
                  [newDeadline.toISOString(), u.id, bid]
                );
              }
            }
          }

          // F7: Recalculate last-minute discount for each group member after move
          const bizRes = await client.query(`SELECT plan, settings FROM businesses WHERE id = $1`, [bid]);
          const bizSettings = bizRes.rows[0]?.settings || {};
          if (bizSettings.last_minute_enabled && (bizRes.rows[0]?.plan || 'free') !== 'free') {
            const lmDeadline = bizSettings.last_minute_deadline || 'j-1';
            const todayBrussels = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
            for (const u of updates) {
              const newStartBrussels = new Date(u.start_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
              const inLmWindow = isWithinLastMinuteWindow(newStartBrussels, todayBrussels, lmDeadline);
              const svcRes = await client.query(
                `SELECT s.price_cents, s.promo_eligible, COALESCE(sv.price_cents, s.price_cents, 0) AS eff_price
                 FROM bookings b LEFT JOIN services s ON s.id = b.service_id
                 LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                 WHERE b.id = $1`, [u.id]
              );
              const svc = svcRes.rows[0];
              const lmMinPrice = bizSettings.last_minute_min_price_cents || 0;
              let newDiscountPct = null;
              if (inLmWindow && svc && svc.promo_eligible !== false && svc.eff_price > 0 && svc.eff_price >= lmMinPrice) {
                newDiscountPct = bizSettings.last_minute_discount_pct || 10;
              }
              await client.query(
                `UPDATE bookings SET discount_pct = $1 WHERE id = $2 AND business_id = $3`,
                [newDiscountPct, u.id, bid]
              );
            }
          }

          // Recalculate promotion discount after LM discount change (group)
          {
            const grpPromoCheck = await client.query(
              `SELECT promotion_id, promotion_discount_pct, promotion_discount_cents FROM bookings WHERE id = ANY($1::uuid[]) AND promotion_id IS NOT NULL LIMIT 1`,
              [updates.map(u => u.id)]
            );
            const grpPromoId = grpPromoCheck.rows[0]?.promotion_id;
            const grpStoredPct = grpPromoCheck.rows[0]?.promotion_discount_pct;
            const grpStoredCents = grpPromoCheck.rows[0]?.promotion_discount_cents;
            if (grpPromoId) {
              const promoRes = await client.query(`SELECT * FROM promotions WHERE id = $1`, [grpPromoId]);
              const promo = promoRes.rows[0];
              if (promo) {
                // Promo earned at booking time stays earned on move — we no longer
                // wipe when the new date falls outside condition_start_date/end_date
                // or when is_active flipped to false. Only the discount amount is
                // recalculated below (relevant if LM% changed), using the RATE/AMOUNT
                // stored on the booking at creation — not promo.reward_value — so
                // an admin lowering the promo doesn't shrink a client's earned discount.
                const allIds = updates.map(u => u.id);
                let groupTotal = 0;
                for (const uid of allIds) {
                  const mRes = await client.query(
                    `SELECT COALESCE(sv.price_cents, s.price_cents, 0) AS eff_price, b.discount_pct
                     FROM bookings b
                     LEFT JOIN services s ON s.id = b.service_id
                     LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                     WHERE b.id = $1`, [uid]
                  );
                  const m = mRes.rows[0];
                  if (m) {
                    groupTotal += m.discount_pct
                      ? Math.round(m.eff_price * (100 - m.discount_pct) / 100)
                      : m.eff_price;
                  }
                }
                let newPromoCents = 0;
                if (promo.reward_type === 'discount_pct') {
                  const pct = grpStoredPct != null ? grpStoredPct : promo.reward_value;
                  newPromoCents = Math.round(groupTotal * pct / 100);
                } else if (promo.reward_type === 'discount_fixed') {
                  const cents = grpStoredCents != null ? grpStoredCents : promo.reward_value;
                  newPromoCents = Math.min(cents, groupTotal);
                } else if (promo.reward_type === 'free_service' && promo.reward_service_id) {
                  const freeRes = await client.query(
                    `SELECT COALESCE(sv.price_cents, s.price_cents, 0) AS eff_price, b.discount_pct
                     FROM bookings b
                     LEFT JOIN services s ON s.id = b.service_id
                     LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                     WHERE b.service_id = $1 AND b.id = ANY($2::uuid[])`,
                    [promo.reward_service_id, allIds]
                  );
                  if (freeRes.rows[0]) {
                    const fp = freeRes.rows[0];
                    newPromoCents = fp.discount_pct
                      ? Math.round(fp.eff_price * (100 - fp.discount_pct) / 100)
                      : fp.eff_price;
                  }
                }
                if (newPromoCents >= 0 && promo.reward_type !== 'info_only') {
                  const newPromoPct = groupTotal > 0 ? Math.round(newPromoCents / groupTotal * 100) : 0;
                  for (const uid of allIds) {
                    await client.query(
                      `UPDATE bookings SET promotion_discount_cents = $1, promotion_discount_pct = $2
                       WHERE id = $3 AND business_id = $4 AND promotion_id IS NOT NULL`,
                      [newPromoCents, newPromoPct, uid, bid]
                    );
                  }
                }
              }
            }
          }

          // Recalculate booked_price_cents for each group member after LM discount changes
          // SKIP for quote_only services (merchant-set price)
          for (const u of updates) {
            const pRes = await client.query(
              `SELECT COALESCE(sv.price_cents, s.price_cents, 0) AS eff_price, b.discount_pct, s.quote_only
               FROM bookings b
               LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               WHERE b.id = $1`, [u.id]
            );
            const p = pRes.rows[0];
            if (p && !p.quote_only) {
              const bookedPrice = p.discount_pct
                ? Math.round(p.eff_price * (100 - p.discount_pct) / 100)
                : p.eff_price;
              await client.query(
                `UPDATE bookings SET booked_price_cents = $1 WHERE id = $2 AND business_id = $3`,
                [bookedPrice, u.id, bid]
              );
            }
          }

          // H10 fix: sync DRAFT invoices after booked_price_cents change (parity with public reschedule)
          await syncDraftInvoicesForBookings(client, updates.map(u => u.id));

          // Recalculate deposit_amount_cents for group after price changes
          // SKIP for quote_only groups — merchant set a specific amount manually
          if (draggedBooking.deposit_required) {
            const _gdQo = await client.query(
              `SELECT 1 FROM bookings b LEFT JOIN services s ON s.id = b.service_id WHERE b.group_id = $1 AND s.quote_only = true LIMIT 1`,
              [draggedBooking.group_id]
            );
            const _gdRes = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [bid]);
            const _gds = _gdRes.rows[0]?.settings || {};
            const _gdType = _gds.deposit_type || 'percent';
            const _gdPct = parseInt(_gds.deposit_percent) || 0;
            const _gdFixed = parseInt(_gds.deposit_fixed_cents) || 0;
            if (_gdQo.rows.length === 0 && ((_gdType === 'percent' && _gdPct > 0) || (_gdType === 'fixed' && _gdFixed > 0))) {
              // H6 fix bis: promo peut être sur sibling non-primary (cf booking-reschedule.js même fix)
              const _gtRes = await client.query(
                `SELECT COALESCE(SUM(booked_price_cents), 0) AS total,
                        COALESCE(SUM(promotion_discount_cents), 0) AS promo
                 FROM bookings WHERE group_id = $1 AND business_id = $2`, [draggedBooking.group_id, bid]);
              const _gEff = Math.max((parseInt(_gtRes.rows[0].total) || 0) - (parseInt(_gtRes.rows[0].promo) || 0), 0);
              const _gNewDep = _gdType === 'fixed' ? Math.min(_gdFixed, _gEff) : Math.round(_gEff * _gdPct / 100);
              await client.query(
                `UPDATE bookings SET deposit_amount_cents = $1 WHERE group_id = $2 AND business_id = $3 AND deposit_status = 'pending'`,
                [_gNewDep, draggedBooking.group_id, bid]);
            }
          }

          await client.query(
            `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
             VALUES ($1, $2, 'booking', $3, 'group_move', $4, $5)`,
            [bid, req.user.id, id,
             JSON.stringify({ group_id: draggedBooking.group_id, original_start: draggedBooking.start_at }),
             JSON.stringify({ new_start: totalStart, new_end: totalEnd })]
          );
        });
      } catch (err) {
        if (err.type === 'conflict' || err.type === 'immutable') return res.status(err.type === 'conflict' ? 409 : 400).json({ error: err.message });
        throw err;
      }

      // Send notification for group moves if requested
      let groupNotifResult = null;
      if (shouldNotify) {
        try {
          // Fetch first member + client + business context
          const fullBk = await queryWithRLS(bid,
            `SELECT b.*, c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
                    CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                    s.category AS service_category,
                    COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                    COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                    p.display_name AS practitioner_name,
                    biz.name AS business_name, biz.theme, biz.address, biz.email AS business_email, biz.phone AS business_phone,
                    biz.settings AS business_settings
             FROM bookings b
             LEFT JOIN clients c ON c.id = b.client_id
             LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             JOIN practitioners p ON p.id = b.practitioner_id
             JOIN businesses biz ON biz.id = b.business_id
             WHERE b.id = $1 AND b.business_id = $2`,
            [id, bid]
          );
          const bk = fullBk.rows[0];
          if (bk && bk.client_email) {
            // Fetch all group siblings for the email (multi-service listing)
            const siblingsRes = await queryWithRLS(bid,
              `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name,
                      COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                      COALESCE(sv.price_cents, s.price_cents) AS price_cents,
                      b.discount_pct,
                      p.display_name AS practitioner_name
               FROM bookings b
               LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               JOIN practitioners p ON p.id = b.practitioner_id
               WHERE b.group_id = $1 AND b.business_id = $2
                 AND b.status NOT IN ('cancelled')
               ORDER BY b.group_order`,
              [draggedBooking.group_id, bid]
            );
            // Apply discount_pct to get post-LM prices
            siblingsRes.rows.forEach(r => {
              if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); }
            });
            const groupServices = siblingsRes.rows;

            // Only change status to modified_pending if time actually changed
            const refStart = old_start_at || draggedBooking.start_at;
            const refEnd = old_end_at || draggedBooking.end_at;
            const groupTimeMoved = new Date(refStart).getTime() !== new Date(bk.start_at).getTime() || new Date(refEnd).getTime() !== new Date(bk.end_at).getTime();
            if (groupTimeMoved) {
              const newStatus = bk.status === 'pending_deposit' ? 'pending_deposit' : 'modified_pending';
              await queryWithRLS(bid,
                `UPDATE bookings SET status = $1, updated_at = NOW()
                 WHERE group_id = $2 AND business_id = $3
                   AND status NOT IN ('cancelled', 'completed', 'no_show')`,
                [newStatus, draggedBooking.group_id, bid]
              );
            }

            // Use the full group time range (first start → last end)
            const groupTimeRes = await queryWithRLS(bid,
              `SELECT MIN(start_at) AS group_start, MAX(end_at) AS group_end
               FROM bookings WHERE group_id = $1 AND business_id = $2
                 AND status NOT IN ('cancelled')`,
              [draggedBooking.group_id, bid]
            );
            const gt = groupTimeRes.rows[0];

            groupNotifResult = {};
            if (effectiveChannel === 'email' || effectiveChannel === 'both') {
              const emailResult = await sendModificationEmail({
                booking: {
                  client_name: bk.client_name,
                  client_email: bk.client_email,
                  public_token: bk.public_token,
                  service_name: bk.service_name,
                  service_category: bk.service_category,
                  practitioner_name: bk.practitioner_name,
                  // H11 fix: pass raw + booked + discount_pct séparés pour que le template affiche LM barré
                  service_price_cents: bk.service_price_cents,
                  booked_price_cents: bk.booked_price_cents,
                  discount_pct: bk.discount_pct,
                  duration_min: bk.duration_min,
                  promotion_label: bk.promotion_label,
                  promotion_discount_cents: bk.promotion_discount_cents,
                  promotion_discount_pct: bk.promotion_discount_pct,
                  deposit_status: bk.deposit_status,
                  deposit_amount_cents: bk.deposit_amount_cents,
                  deposit_paid_at: bk.deposit_paid_at,
                  deposit_deadline: bk.deposit_deadline,
                  comment_client: bk.comment_client,
                  old_start_at: old_start_at || draggedBooking.start_at,
                  old_end_at: old_end_at || draggedBooking.end_at,
                  new_start_at: gt.group_start,
                  new_end_at: gt.group_end
                },
                business: {
                  id: bid,
                  name: bk.business_name,
                  email: bk.business_email,
                  phone: bk.business_phone,
                  theme: bk.theme || {},
                  address: bk.address,
                  settings: bk.business_settings
                },
                groupServices: groupServices.length > 1 ? groupServices : undefined
              });
              groupNotifResult.email = emailResult.success ? 'sent' : 'error';
              if (emailResult.error) groupNotifResult.email_detail = emailResult.error;
            }
            if ((effectiveChannel === 'sms' || effectiveChannel === 'both') && bk.client_phone) {
              try {
                const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
                const manageLink = `${baseUrl}/booking/${bk.public_token}`;
                const newDateStr = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
                const newTimeStr = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
                const timeMoved = new Date(refStart).getTime() !== new Date(bk.start_at).getTime() || new Date(refEnd).getTime() !== new Date(bk.end_at).getTime();
                const _svcLabel = bk.service_name || 'prestation';
                const smsBody = timeMoved
                  ? `${bk.business_name}: Votre RDV "${_svcLabel}" a été modifié — ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`
                  : `${bk.business_name}: Rappel, RDV "${_svcLabel}" le ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`;
                const smsResult = await sendSMS({ to: bk.client_phone, body: smsBody, businessId: bid, clientId: bk.client_id });
                groupNotifResult.sms = smsResult.success ? 'sent' : 'error';
              } catch (e) { console.warn('[MOVE] Group SMS error:', e.message); groupNotifResult.sms = 'error'; }
            }
          }
        } catch (e) {
          console.warn('[MOVE] Group notification error:', e.message);
        }
      }

      broadcast(bid, 'booking_update', { action: 'moved' });
      // H-07 fix: invalidate minisite cache (slot déplacé)
      try { invalidateMinisiteCache(bid); } catch (_) {}
      updates.forEach(u => calSyncPush(bid, u.id).catch(() => {}));

      // Notify waitlist for freed OLD slots — one per group member (non-blocking)
      try {
        const { processWaitlistForCancellation } = require('../../services/waitlist');
        for (const gm of groupMembers) {
          await processWaitlistForCancellation(gm.id, bid, { start_at: gm.start_at, end_at: gm.end_at }).catch(() => {});
        }
      } catch (_) {}

      return res.json({ updated: true, group_moved: true, count: updates.length, notification: groupNotifResult });
    }

    // ── SINGLE MOVE (no group) ──
    // Preserve the actual duration from the calendar (frontend sends correct end_at)
    const newEnd = new Date(end_at);

    // Check practitioner availability (absences, exceptions, hours)
    const availCheckSingle = await checkPracAvailability(bid, effectivePracId, start_at, end_at);
    if (!availCheckSingle.ok) {
      return res.status(409).json({ error: availCheckSingle.reason });
    }

    // Atomic single move: conflict check + update + deposit deadline recalc in one transaction
    let moveResult;
    try {
      moveResult = await transactionWithRLS(bid, async (client) => {
        // Bug H6 fix: Re-check status inside transaction with FOR UPDATE
        const statusRecheck = await client.query(
          `SELECT status FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [id, bid]
        );
        const IMMUTABLE_TX = ['cancelled', 'completed', 'no_show'];
        if (statusRecheck.rows.length === 0 || IMMUTABLE_TX.includes(statusRecheck.rows[0].status)) {
          throw Object.assign(new Error('Ce RDV ne peut plus être modifié'), { type: 'immutable' });
        }

        if (!globalAllowOverlap) {
          const conflicts = await checkBookingConflicts(client, { bid, pracId: effectivePracId, newStart: newStart.toISOString(), newEnd: newEnd.toISOString(), excludeIds: id, movingProcTime: parseInt(draggedBooking.processing_time) || 0, movingProcStart: parseInt(draggedBooking.processing_start) || 0, movingBufferBefore: parseInt(draggedBooking.buffer_before_min) || 0 });
          if (conflicts.length >= maxConcurrent) {
            throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
          }
        }

        // BUG-MOVE-CONFEXP fix: if the booking was 'pending' (awaiting client confirmation),
// the original confirmation_expires_at was set at creation — moving to a far-future
// date leaves the deadline in place, so the cron would auto-cancel shortly after.
// Reset to NULL so the cron only acts on start_at.
let sql = `UPDATE bookings SET start_at = $1, end_at = $2, reminder_24h_sent_at = NULL, reminder_2h_sent_at = NULL, confirmation_expires_at = CASE WHEN status = 'pending' THEN NULL ELSE confirmation_expires_at END, updated_at = NOW()`;
        const params = [newStart.toISOString(), newEnd.toISOString()];
        let idx = 3;

        if (practitioner_id) {
          sql += `, practitioner_id = $${idx}`;
          params.push(practitioner_id);
          idx++;
        }

        sql += ` WHERE id = $${idx} AND business_id = $${idx + 1} AND status NOT IN ('cancelled', 'completed', 'no_show') RETURNING id, start_at, end_at, practitioner_id, deposit_required, deposit_deadline, deposit_status`;
        params.push(id, bid);

        const r = await client.query(sql, params);

        // Recalculate deposit deadline using fresh calculation (matches group move pattern)
        // Skip if already paid — no sense pushing the deadline of a paid deposit.
        const moved = r.rows[0];
        if (moved && moved.deposit_required && moved.deposit_deadline && moved.deposit_status === 'pending') {
          const { computeDepositDeadline } = require('../../routes/public/helpers');
          const _depBizSingle = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [bid]);
          const newDeadline = computeDepositDeadline(new Date(moved.start_at), _depBizSingle.rows[0]?.settings || {}, moved.deposit_deadline);
          await client.query(
            `UPDATE bookings SET deposit_deadline = $1 WHERE id = $2 AND business_id = $3`,
            [newDeadline.toISOString(), id, bid]
          );
        }

        // F7: Recalculate last-minute discount after move
        if (moved) {
          const bizRes = await client.query(`SELECT plan, settings FROM businesses WHERE id = $1`, [bid]);
          const bizSettings = bizRes.rows[0]?.settings || {};
          if (bizSettings.last_minute_enabled && (bizRes.rows[0]?.plan || 'free') !== 'free') {
            const lmDeadline = bizSettings.last_minute_deadline || 'j-1';
            const newStartBrussels = new Date(moved.start_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
            const todayBrussels = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
            const inLmWindow = isWithinLastMinuteWindow(newStartBrussels, todayBrussels, lmDeadline);
            // Fetch service price + promo_eligible to validate LM discount
            const svcRes = await client.query(
              `SELECT s.price_cents, s.promo_eligible, COALESCE(sv.price_cents, s.price_cents, 0) AS eff_price
               FROM bookings b LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               WHERE b.id = $1`, [id]
            );
            const svc = svcRes.rows[0];
            const lmMinPrice = bizSettings.last_minute_min_price_cents || 0;
            let newDiscountPct = null;
            if (inLmWindow && svc && svc.promo_eligible !== false && svc.eff_price > 0 && svc.eff_price >= lmMinPrice) {
              newDiscountPct = bizSettings.last_minute_discount_pct || 10;
            }
            // Only update if discount_pct actually changes
            await client.query(
              `UPDATE bookings SET discount_pct = $1 WHERE id = $2 AND business_id = $3`,
              [newDiscountPct, id, bid]
            );
          }
        }

        // Recalculate promotion discount after LM discount change (single)
        if (moved) {
          const singlePromoCheck = await client.query(
            `SELECT promotion_id, promotion_discount_pct, promotion_discount_cents FROM bookings WHERE id = $1 AND promotion_id IS NOT NULL`, [id]
          );
          const singlePromoId = singlePromoCheck.rows[0]?.promotion_id;
          const singleStoredPct = singlePromoCheck.rows[0]?.promotion_discount_pct;
          const singleStoredCents = singlePromoCheck.rows[0]?.promotion_discount_cents;
          if (singlePromoId) {
            const promoRes = await client.query(`SELECT * FROM promotions WHERE id = $1`, [singlePromoId]);
            const promo = promoRes.rows[0];
            // Promo earned at booking time stays earned on move — no longer wiped
            // when the new date is out of condition range or is_active flipped.
            // Recalc uses the rate/amount STORED on the booking (earned-is-earned),
            // not promo.reward_value, so admin edits don't shrink past discounts.
            if (promo) {
              const mRes = await client.query(
                `SELECT COALESCE(sv.price_cents, s.price_cents, 0) AS eff_price, b.discount_pct
                 FROM bookings b
                 LEFT JOIN services s ON s.id = b.service_id
                 LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
                 WHERE b.id = $1`, [id]
              );
              const m = mRes.rows[0];
              if (m) {
                const adjPrice = m.discount_pct
                  ? Math.round(m.eff_price * (100 - m.discount_pct) / 100)
                  : m.eff_price;
                let newPromoCents = 0;
                if (promo.reward_type === 'discount_pct') {
                  const pct = singleStoredPct != null ? singleStoredPct : promo.reward_value;
                  newPromoCents = Math.round(adjPrice * pct / 100);
                } else if (promo.reward_type === 'discount_fixed') {
                  const cents = singleStoredCents != null ? singleStoredCents : promo.reward_value;
                  newPromoCents = Math.min(cents, adjPrice);
                } else if (promo.reward_type === 'free_service' && promo.reward_service_id) {
                  // For single booking with free_service, discount = service price
                  newPromoCents = adjPrice;
                }
                if (newPromoCents >= 0 && promo.reward_type !== 'info_only') {
                  const newPromoPct = adjPrice > 0 ? Math.round(newPromoCents / adjPrice * 100) : 0;
                  await client.query(
                    `UPDATE bookings SET promotion_discount_cents = $1, promotion_discount_pct = $2
                     WHERE id = $3 AND business_id = $4 AND promotion_id IS NOT NULL`,
                    [newPromoCents, newPromoPct, id, bid]
                  );
                }
              }
            }
          }
        }

        // Recalculate booked_price_cents after LM discount change (single)
        // SKIP for quote_only services (merchant-set price)
        if (moved) {
          const pRes = await client.query(
            `SELECT COALESCE(sv.price_cents, s.price_cents, 0) AS eff_price, b.discount_pct, s.quote_only
             FROM bookings b
             LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             WHERE b.id = $1`, [id]
          );
          const p = pRes.rows[0];
          if (p && !p.quote_only) {
            const bookedPrice = p.discount_pct
              ? Math.round(p.eff_price * (100 - p.discount_pct) / 100)
              : p.eff_price;
            await client.query(
              `UPDATE bookings SET booked_price_cents = $1 WHERE id = $2 AND business_id = $3`,
              [bookedPrice, id, bid]
            );
          }
          // H10 fix: sync DRAFT invoices after booked_price_cents change (single move)
          await syncDraftInvoicesForBookings(client, [id]);
        }

        // M2 fix: Recalculate deposit_amount_cents when price changed on move (handles both percent AND fixed)
        // SKIP for quote_only — merchant set a specific amount manually
        if (moved && moved.deposit_required) {
          const _depRes = await client.query(
            `SELECT biz.settings AS biz_settings, b.booked_price_cents, b.promotion_discount_cents, s.quote_only
             FROM bookings b JOIN businesses biz ON biz.id = b.business_id
             LEFT JOIN services s ON s.id = b.service_id
             WHERE b.id = $1 AND b.business_id = $2`, [id, bid]
          );
          const _dr = _depRes.rows[0];
          if (_dr && !_dr.quote_only) {
            const _ds = _dr.biz_settings || {};
            const _depType = _ds.deposit_type || 'percent';
            const _depPct = parseInt(_ds.deposit_percent) || 0;
            const _depFixed = parseInt(_ds.deposit_fixed_cents) || 0;
            if ((_depType === 'percent' && _depPct > 0) || (_depType === 'fixed' && _depFixed > 0)) {
              const _effPrice = Math.max((_dr.booked_price_cents || 0) - (_dr.promotion_discount_cents || 0), 0);
              const _newDepAmt = _depType === 'fixed' ? Math.min(_depFixed, _effPrice) : Math.round(_effPrice * _depPct / 100);
              await client.query(`UPDATE bookings SET deposit_amount_cents = $1 WHERE id = $2 AND business_id = $3 AND deposit_status = 'pending'`, [_newDepAmt, id, bid]);
            }
          }
        }

        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'move', $4, $5)`,
          [bid, req.user.id, id,
           JSON.stringify(old.rows[0]),
           JSON.stringify({ start_at: newStart.toISOString(), end_at: newEnd.toISOString(), practitioner_id })]
        );

        // C2 fix: hoist sRefStart/sRefEnd so post-commit SMS can access them
        const sRefStart = old_start_at || draggedBooking.start_at;
        const sRefEnd = old_end_at || draggedBooking.end_at;

        // Pre-set modified_pending inside transaction if notify requested and time moved
        if (shouldNotify) {
          const timeMoved = new Date(sRefStart).getTime() !== newStart.getTime() || new Date(sRefEnd).getTime() !== newEnd.getTime();
          if (timeMoved) {
            const curStatus = old.rows[0].status;
            const mNewStatus = curStatus === 'pending_deposit' ? 'pending_deposit' : 'modified_pending';
            await client.query(
              `UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3`,
              [mNewStatus, id, bid]
            );
            if (draggedBooking.group_id) {
              await client.query(
                `UPDATE bookings SET status = $1, updated_at = NOW()
                 WHERE group_id = $2 AND business_id = $3 AND id != $4
                   AND status NOT IN ('cancelled', 'completed', 'no_show')`,
                [mNewStatus, draggedBooking.group_id, bid, id]
              );
            }
          }
        }

        return r;
      });
    } catch (err) {
      if (err.type === 'conflict' || err.type === 'immutable') return res.status(err.type === 'conflict' ? 409 : 400).json({ error: err.message });
      throw err;
    }

    // Send notification if requested (drag-drop → "Notifier" button)
    let notificationResult = null;
    if (shouldNotify) {
      try {
        // Fetch full context for the notification email
        const fullBk = await queryWithRLS(bid,
          `SELECT b.*, c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
                  CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
                  s.category AS service_category,
                  COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
                  COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
                  p.display_name AS practitioner_name,
                  biz.name AS business_name, biz.theme, biz.address,
                  biz.email AS business_email, biz.phone AS business_phone,
                  biz.settings AS business_settings
           FROM bookings b
           LEFT JOIN clients c ON c.id = b.client_id
           LEFT JOIN services s ON s.id = b.service_id
           LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
           JOIN practitioners p ON p.id = b.practitioner_id
           JOIN businesses biz ON biz.id = b.business_id
           WHERE b.id = $1 AND b.business_id = $2`,
          [id, bid]
        );
        const bk = fullBk.rows[0];
        if (bk && bk.client_email) {

          notificationResult = {};
          if (effectiveChannel === 'email' || effectiveChannel === 'both') {
            try {
              const emailResult = await sendModificationEmail({
                booking: {
                  client_name: bk.client_name,
                  client_email: bk.client_email,
                  public_token: bk.public_token,
                  service_name: bk.service_name,
                  service_category: bk.service_category,
                  practitioner_name: bk.practitioner_name,
                  // H11 fix: pass raw + booked + discount_pct séparés pour que le template affiche LM barré
                  service_price_cents: bk.service_price_cents,
                  booked_price_cents: bk.booked_price_cents,
                  discount_pct: bk.discount_pct,
                  duration_min: bk.duration_min,
                  promotion_label: bk.promotion_label,
                  promotion_discount_cents: bk.promotion_discount_cents,
                  promotion_discount_pct: bk.promotion_discount_pct,
                  deposit_status: bk.deposit_status,
                  deposit_amount_cents: bk.deposit_amount_cents,
                  deposit_paid_at: bk.deposit_paid_at,
                  deposit_deadline: bk.deposit_deadline,
                  comment_client: bk.comment_client,
                  old_start_at: old_start_at || draggedBooking.start_at,
                  old_end_at: old_end_at || draggedBooking.end_at,
                  new_start_at: bk.start_at,
                  new_end_at: bk.end_at
                },
                business: {
                  id: bid,
                  name: bk.business_name,
                  email: bk.business_email,
                  phone: bk.business_phone,
                  theme: bk.theme || {},
                  address: bk.address,
                  settings: bk.business_settings
                }
              });
              notificationResult.email = emailResult.success ? 'sent' : 'error';
              if (emailResult.error) notificationResult.email_detail = emailResult.error;
            } catch (e) {
              console.warn('[MOVE] Email notification error:', e.message);
              notificationResult.email = 'error';
            }
          }
          if ((effectiveChannel === 'sms' || effectiveChannel === 'both') && bk.client_phone) {
            try {
              const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
              const manageLink = `${baseUrl}/booking/${bk.public_token}`;
              const newDateStr = new Date(bk.start_at).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
              const newTimeStr = new Date(bk.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
              const timeMoved = new Date(old_start_at || draggedBooking.start_at).getTime() !== new Date(bk.start_at).getTime() || new Date(old_end_at || draggedBooking.end_at).getTime() !== new Date(bk.end_at).getTime();
              const _svcLabel = bk.service_name || 'prestation';
              const smsBody = timeMoved
                ? `${bk.business_name}: Votre RDV "${_svcLabel}" a été modifié — ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`
                : `${bk.business_name}: Rappel, RDV "${_svcLabel}" le ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`;
              const smsResult = await sendSMS({ to: bk.client_phone, body: smsBody, businessId: bid, clientId: bk.client_id });
              notificationResult.sms = smsResult.success ? 'sent' : 'error';
            } catch (e) { console.warn('[MOVE] SMS error:', e.message); notificationResult.sms = 'error'; }
          }
        }
      } catch (e) {
        console.warn('[MOVE] Notification error:', e.message);
      }
    }

    broadcast(bid, 'booking_update', { action: 'moved' });
    // BUG-MOVE-CACHE fix: parity with /move group (L599), /resize (L1370), /modify (L1662) —
    // single-booking move also frees a slot; minisite cache must be invalidated.
    try { invalidateMinisiteCache(bid); } catch (_) {}
    calSyncPush(bid, id).catch(() => {});

    // Notify waitlist for the freed OLD slot (non-blocking)
    try {
      const { processWaitlistForCancellation } = require('../../services/waitlist');
      await processWaitlistForCancellation(id, bid, { start_at: old_start_at || draggedBooking.start_at, end_at: old_end_at || draggedBooking.end_at });
    } catch (_) {}

    res.json({ updated: true, booking: moveResult.rows[0], notification: notificationResult });
  } catch (err) {
    console.error('[MOVE] Crash for booking', req.params.id, ':', err.message, err.stack?.split('\n')[1]);
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/edit — Edit booking fields (unified modal)
// UI: Calendar → detail modal → Enregistrer
// ============================================================
router.patch('/:id/edit', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    // STS-V12-007: UUID validation
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { practitioner_id, comment, internal_note, custom_label, color, locked, service_id, service_variant_id, booked_price_cents } = req.body;

    // CRT-13: Validate comment/note length
    if (comment && comment.length > 5000) {
      return res.status(400).json({ error: 'Commentaire trop long (max 5000 caractères)' });
    }
    if (internal_note && internal_note.length > 10000) {
      return res.status(400).json({ error: 'Note interne trop longue (max 10000 caractères)' });
    }

    // Prevent practitioners from reassigning bookings to other practitioners
    if (practitioner_id !== undefined && req.user.role === 'practitioner') {
      return res.status(403).json({ error: 'Vous ne pouvez pas réaffecter un RDV à un autre praticien' });
    }

    // Validate color hex format
    if (color !== undefined && color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Format de couleur invalide (ex: #FF5733)' });
    }

    // Pre-flight existence check (non-authoritative; real guard is inside transaction)
    const statusCheck = await queryWithRLS(bid,
      `SELECT status, practitioner_id FROM bookings WHERE id = $1 AND business_id = $2`, [id, bid]
    );
    if (statusCheck.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Practitioner scope: can only edit own bookings
    if (req.practitionerFilter && String(statusCheck.rows[0].practitioner_id) !== String(req.practitionerFilter)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    // CRT-V11: For immutable statuses, only block time-related and practitioner changes.
    // Allow annotation-only edits (comment, internal_note, custom_label, color).
    const IMMUTABLE_EDIT = ['cancelled', 'completed', 'no_show'];
    if (IMMUTABLE_EDIT.includes(statusCheck.rows[0].status)) {
      if (practitioner_id !== undefined) {
        return res.status(400).json({ error: 'Ce RDV ne peut plus être modifié (changement de praticien interdit)' });
      }
      // Only annotation fields are allowed for immutable statuses
      const allowedFields = ['comment', 'internal_note', 'custom_label', 'color', 'locked'];
      const requestedFields = Object.keys(req.body).filter(k => req.body[k] !== undefined);
      const hasDisallowedField = requestedFields.some(k => !allowedFields.includes(k));
      if (hasDisallowedField) {
        return res.status(400).json({ error: 'Ce RDV ne peut plus être modifié (seuls commentaire, note interne, libellé et couleur sont autorisés)' });
      }
    }

    // Service conversion (freestyle ↔ service)
    let serviceConversion = null;
    if (service_id !== undefined) {
      // Block on grouped bookings
      const groupCheck2 = await queryWithRLS(bid,
        `SELECT group_id FROM bookings WHERE id = $1 AND business_id = $2`, [id, bid]);
      if (groupCheck2.rows[0]?.group_id) {
        return res.status(400).json({ error: 'Impossible de changer la prestation d\'un RDV groupé.' });
      }

      if (service_id === null) {
        serviceConversion = { toFree: true };
      } else {
        if (!UUID_RE.test(service_id)) return res.status(400).json({ error: 'service_id invalide' });
        const svcCheck = await queryWithRLS(bid,
          `SELECT id, duration_min, buffer_before_min, buffer_after_min, processing_time, processing_start, price_cents, quote_only
           FROM services WHERE id = $1 AND business_id = $2 AND is_active = true`,
          [service_id, bid]);
        if (svcCheck.rows.length === 0) return res.status(400).json({ error: 'Service introuvable ou inactif' });
        const svc = svcCheck.rows[0];
        let dur = svc.duration_min, pt = svc.processing_time || 0, ps = svc.processing_start || 0;
        let varPriceCents = null;

        if (service_variant_id) {
          if (!UUID_RE.test(service_variant_id)) return res.status(400).json({ error: 'variant_id invalide' });
          const varCheck = await queryWithRLS(bid,
            `SELECT duration_min, processing_time, processing_start, price_cents
             FROM service_variants WHERE id = $1 AND service_id = $2`,
            [service_variant_id, service_id]);
          if (varCheck.rows.length > 0) {
            dur = varCheck.rows[0].duration_min || dur;
            pt = varCheck.rows[0].processing_time ?? pt;
            ps = varCheck.rows[0].processing_start ?? ps;
            varPriceCents = varCheck.rows[0].price_cents;
          }
        }

        // Compute new booked_price_cents from service/variant price + booking discount_pct
        // For conversion TO a quote_only service, preserve existing booked_price_cents (merchant manually set it)
        const bkForEnd = await queryWithRLS(bid,
          `SELECT start_at, discount_pct, booked_price_cents FROM bookings WHERE id = $1 AND business_id = $2`, [id, bid]);
        const bkRow = bkForEnd.rows[0];
        let newPriceCents;
        if (svc.quote_only) {
          // Keep existing price if set, else 0 (merchant must set via fcSaveQuotePrice)
          newPriceCents = bkRow.booked_price_cents || 0;
        } else {
          newPriceCents = varPriceCents != null ? varPriceCents : (svc.price_cents || 0);
        }
        const startAt = new Date(bkRow.start_at);
        // M5 fix: Re-check LM eligibility for the new service before applying discount
        // SKIP for quote_only — LM doesn't apply to custom-priced bookings
        let newDiscountPct = null;
        if (bkRow.discount_pct && !svc.quote_only) {
          const lmCheck = await queryWithRLS(bid,
            `SELECT s.promo_eligible, biz.settings FROM services s, businesses biz WHERE s.id = $1 AND biz.id = $2`, [service_id, bid]);
          const lmc = lmCheck.rows[0];
          const lmMinPrice = lmc?.settings?.last_minute_min_price_cents || 0;
          if (lmc?.promo_eligible !== false && newPriceCents >= lmMinPrice) {
            newPriceCents = Math.round(newPriceCents * (100 - bkRow.discount_pct) / 100);
            newDiscountPct = bkRow.discount_pct;
          } else {
            // New service not eligible for LM — clear discount
            newDiscountPct = null;
          }
        }
        const totalMin = (svc.buffer_before_min || 0) + dur + (svc.buffer_after_min || 0);
        const newEnd = new Date(startAt.getTime() + totalMin * 60000);

        serviceConversion = {
          toService: true, service_id, service_variant_id: service_variant_id || null,
          processing_time: pt, processing_start: ps, end_at: newEnd.toISOString(),
          booked_price_cents: newPriceCents, discount_pct: newDiscountPct
        };
      }
    }

    // If practitioner_id changes, check for conflicts (transaction vars)
    let calState_editConflictNeeded = false;
    let calState_editOverlap = false;
    let calState_editMaxConcurrent = 1;
    let calState_editTimes = null;

    if (practitioner_id !== undefined) {
      // Block reassigning a single member of a group booking
      const groupCheck = await queryWithRLS(bid,
        `SELECT group_id FROM bookings WHERE id = $1 AND business_id = $2`,
        [id, bid]
      );
      if (groupCheck.rows.length > 0 && groupCheck.rows[0].group_id) {
        return res.status(400).json({ error: 'Impossible de réaffecter un seul élément d\'un groupe. Déplacez le groupe entier.' });
      }

      // Verify new practitioner exists and is active
      const pracCheck = await queryWithRLS(bid,
        `SELECT id, is_active FROM practitioners WHERE id = $1 AND business_id = $2`,
        [practitioner_id, bid]
      );
      if (pracCheck.rows.length === 0 || !pracCheck.rows[0].is_active) {
        return res.status(400).json({ error: 'Praticien introuvable ou inactif' });
      }

      // Check target practitioner working hours
      const bkTimes = await queryWithRLS(bid,
        `SELECT b.start_at, b.end_at, b.processing_time, b.processing_start, COALESCE(s.buffer_before_min, 0) AS buffer_before_min
         FROM bookings b LEFT JOIN services s ON s.id = b.service_id WHERE b.id = $1 AND b.business_id = $2`,
        [id, bid]
      );
      // Check target practitioner availability (absences, exceptions, hours)
      if (bkTimes.rows[0]) {
        const availCheckReassign = await checkPracAvailability(bid, practitioner_id, bkTimes.rows[0].start_at, bkTimes.rows[0].end_at);
        if (!availCheckReassign.ok) {
          return res.status(409).json({ error: availCheckReassign.reason });
        }
      }

      // Check conflicts with new practitioner's schedule (reuse bkTimes from above)
      // This will be done inside a transaction below for atomicity
      calState_editConflictNeeded = true;
      calState_editOverlap = await businessAllowsOverlap(bid);
      calState_editMaxConcurrent = calState_editOverlap ? Infinity : await getMaxConcurrent(bid, practitioner_id);
      calState_editTimes = bkTimes.rows[0];
    }

    const sets = [];
    const params = [];
    let idx = 1;

    if (practitioner_id !== undefined) { sets.push(`practitioner_id = $${idx++}`); params.push(practitioner_id); }
    if (comment !== undefined) { sets.push(`comment_client = $${idx++}`); params.push(comment || null); }
    if (internal_note !== undefined) { sets.push(`internal_note = $${idx++}`); params.push(internal_note || null); }
    if (custom_label !== undefined) { sets.push(`custom_label = $${idx++}`); params.push(custom_label || null); }
    if (color !== undefined) { sets.push(`color = $${idx++}`); params.push(color || null); }
    if (locked !== undefined) { sets.push(`locked = $${idx++}`); params.push(!!locked); }
    if (booked_price_cents !== undefined) { sets.push(`booked_price_cents = $${idx++}`); params.push(booked_price_cents === null ? null : parseInt(booked_price_cents)); }

    // Service conversion SET clauses
    if (serviceConversion) {
      if (serviceConversion.toFree) {
        sets.push(`service_id = NULL`, `service_variant_id = NULL`, `processing_time = 0`, `processing_start = 0`, `booked_price_cents = NULL`);
      } else {
        sets.push(`service_id = $${idx++}`); params.push(serviceConversion.service_id);
        sets.push(`service_variant_id = $${idx++}`); params.push(serviceConversion.service_variant_id);
        sets.push(`processing_time = $${idx++}`); params.push(serviceConversion.processing_time);
        sets.push(`processing_start = $${idx++}`); params.push(serviceConversion.processing_start);
        sets.push(`end_at = $${idx++}`); params.push(serviceConversion.end_at);
        sets.push(`booked_price_cents = $${idx++}`); params.push(serviceConversion.booked_price_cents);
        sets.push(`discount_pct = $${idx++}`); params.push(serviceConversion.discount_pct);
        sets.push(`custom_label = NULL`);
      }
    }

    if (sets.length === 0) return res.json({ updated: false });

    sets.push('updated_at = NOW()');
    params.push(id, bid);

    const updateSql = `UPDATE bookings SET ${sets.join(', ')} WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING *`;

    // If practitioner reassignment, wrap conflict check + update in a transaction
    let result;
    let oldSnap;
    if (calState_editConflictNeeded && !calState_editOverlap && calState_editTimes) {
      try {
        const txRes = await transactionWithRLS(bid, async (client) => {
          // Bug H6 fix: Re-check status inside transaction with FOR UPDATE
          const snap = await client.query(
            `SELECT practitioner_id, comment_client, internal_note, custom_label, color, status
             FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
            [id, bid]
          );
          // CRT-V11: Block practitioner reassignment for immutable statuses
          if (snap.rows.length > 0 && ['cancelled', 'completed', 'no_show'].includes(snap.rows[0].status) && practitioner_id !== undefined) {
            throw Object.assign(new Error('Ce RDV ne peut plus être modifié (changement de praticien interdit)'), { type: 'immutable' });
          }
          const conflicts = await checkBookingConflicts(client, { bid, pracId: practitioner_id, newStart: calState_editTimes.start_at, newEnd: calState_editTimes.end_at, excludeIds: id, movingProcTime: parseInt(calState_editTimes.processing_time) || 0, movingProcStart: parseInt(calState_editTimes.processing_start) || 0, movingBufferBefore: parseInt(calState_editTimes.buffer_before_min) || 0 });
          if (conflicts.length >= calState_editMaxConcurrent) {
            throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
          }
          const r = await client.query(updateSql, params);

          // Audit log inside transaction for atomicity
          if (r.rows.length > 0) {
            const od = snap.rows.length > 0 ? snap.rows[0] : {};
            const nd = {};
            if (practitioner_id !== undefined) nd.practitioner_id = practitioner_id;
            if (comment !== undefined) nd.comment = comment;
            if (internal_note !== undefined) nd.internal_note = internal_note;
            if (custom_label !== undefined) nd.custom_label = custom_label;
            if (color !== undefined) nd.color = color;
            await client.query(
              `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
               VALUES ($1, $2, 'booking', $3, 'edit', $4, $5)`,
              [bid, req.user.id, id, JSON.stringify(od), JSON.stringify(nd)]
            );
          }

          // H-12 fix: sync draft invoices si service conversion a changé booked_price_cents (L1147).
          if (serviceConversion && r.rows.length > 0) {
            await syncDraftInvoicesForBookings(client, [id]);
          }

          return { result: r, oldSnap: snap };
        });
        result = txRes.result;
        oldSnap = txRes.oldSnap;
      } catch (err) {
        if (err.type === 'conflict' || err.type === 'immutable') return res.status(err.type === 'conflict' ? 409 : 400).json({ error: err.message });
        throw err;
      }
    } else {
      // Wrap update + audit in transaction for atomicity
      const txRes = await transactionWithRLS(bid, async (client) => {
        // Bug H6 fix: Re-check status inside transaction with FOR UPDATE
        const snap = await client.query(
          `SELECT practitioner_id, comment_client, internal_note, custom_label, color, status
           FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [id, bid]
        );
        // CRT-V11: Allow annotation-only edits for immutable statuses (no practitioner change in this branch)
        if (snap.rows.length > 0 && ['cancelled', 'completed', 'no_show'].includes(snap.rows[0].status) && practitioner_id !== undefined) {
          throw Object.assign(new Error('Ce RDV ne peut plus être modifié (changement de praticien interdit)'), { type: 'immutable' });
        }
        const r = await client.query(updateSql, params);

        if (r.rows.length > 0) {
          const od = snap.rows.length > 0 ? snap.rows[0] : {};
          const nd = {};
          if (practitioner_id !== undefined) nd.practitioner_id = practitioner_id;
          if (comment !== undefined) nd.comment = comment;
          if (internal_note !== undefined) nd.internal_note = internal_note;
          if (custom_label !== undefined) nd.custom_label = custom_label;
          if (color !== undefined) nd.color = color;
          await client.query(
            `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
             VALUES ($1, $2, 'booking', $3, 'edit', $4, $5)`,
            [bid, req.user.id, id, JSON.stringify(od), JSON.stringify(nd)]
          );
        }

        // H-12 fix: sync draft invoices si service conversion a changé booked_price_cents (L1147).
        if (serviceConversion && r.rows.length > 0) {
          await syncDraftInvoicesForBookings(client, [id]);
        }

        return { result: r, oldSnap: snap };
      });
      result = txRes.result;
      oldSnap = txRes.oldSnap;
    }

    if (!result || result.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    broadcast(bid, 'booking_update', { action: 'edited' });
    calSyncPush(bid, id).catch(() => {});

    // BUG-EDIT-PRAC-EMAIL fix: if practitioner_id changed, notify the client so they don't
    // discover the new person on arrival. Uses sendPractitionerChangeEmail (same slot, diff pro).
    const _oldPracId = oldSnap?.rows?.[0]?.practitioner_id;
    const _newPracId = result.rows[0]?.practitioner_id;
    if (_oldPracId && _newPracId && String(_oldPracId) !== String(_newPracId)) {
      (async () => {
        try {
          const fullEdit = await queryWithRLS(bid,
            `SELECT b.id, b.public_token, b.start_at, b.end_at, b.custom_label,
                    CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
                    s.category AS service_category,
                    c.full_name AS client_name, c.email AS client_email,
                    p_new.display_name AS new_practitioner_name,
                    p_old.display_name AS old_practitioner_name,
                    biz.name AS biz_name, biz.email AS biz_email, biz.phone AS biz_phone, biz.address AS biz_address,
                    biz.theme AS biz_theme
               FROM bookings b
               LEFT JOIN clients c ON c.id = b.client_id
               LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               LEFT JOIN practitioners p_new ON p_new.id = b.practitioner_id
               LEFT JOIN practitioners p_old ON p_old.id = $2::uuid
               JOIN businesses biz ON biz.id = b.business_id
              WHERE b.id = $1 AND b.business_id = $3`,
            [id, _oldPracId, bid]
          );
          if (fullEdit.rows[0]?.client_email) {
            const ed = fullEdit.rows[0];
            const { sendPractitionerChangeEmail } = require('../../services/email');
            await sendPractitionerChangeEmail({
              booking: {
                client_name: ed.client_name, client_email: ed.client_email,
                public_token: ed.public_token,
                service_name: ed.service_name, service_category: ed.service_category,
                custom_label: ed.custom_label,
                start_at: ed.start_at,
                old_practitioner_name: ed.old_practitioner_name,
                new_practitioner_name: ed.new_practitioner_name
              },
              business: { id: bid, name: ed.biz_name, email: ed.biz_email, phone: ed.biz_phone, address: ed.biz_address, theme: ed.biz_theme }
            });
          }
        } catch (e) { console.warn('[EDIT PRAC EMAIL] error:', e.message); }
      })();
    }

    res.json({ updated: true, booking: result.rows[0] });
  } catch (err) {
    if (err.type === 'immutable') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/resize — Resize duration
// UI: Calendar → drag event bottom edge
// ============================================================
router.patch('/:id/resize', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    // STS-V12-007: UUID validation
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { end_at } = req.body;

    if (!end_at) return res.status(400).json({ error: 'end_at requis' });
    if (isNaN(new Date(end_at).getTime())) {
      return res.status(400).json({ error: 'Format de date invalide' });
    }

    // Get current booking to know start_at, end_at, practitioner, group, status
    const current = await queryWithRLS(bid,
      `SELECT b.start_at, b.end_at, b.practitioner_id, b.group_id, b.status, b.locked,
              b.processing_time, b.processing_start, b.created_at, b.deposit_required,
              COALESCE(s.buffer_before_min, 0) AS buffer_before_min
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (current.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Practitioner scope: can only resize own bookings
    if (req.practitionerFilter && String(current.rows[0].practitioner_id) !== String(req.practitionerFilter)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    // Guard: immutable statuses cannot be resized
    const IMMUTABLE_RESIZE = ['cancelled', 'completed', 'no_show'];
    if (IMMUTABLE_RESIZE.includes(current.rows[0].status)) {
      return res.status(400).json({ error: 'Ce RDV ne peut plus être modifié' });
    }
    const lockCheckResize = isBookingLocked(current.rows[0]);
    if (lockCheckResize.locked) {
      return res.status(400).json({ error: lockCheckResize.reason });
    }

    // Validate end > start
    if (new Date(end_at) <= new Date(current.rows[0].start_at)) {
      return res.status(400).json({ error: 'L\'heure de fin doit être après l\'heure de début' });
    }

    // Block resize for grouped bookings (durations are service-defined)
    if (current.rows[0].group_id) {
      return res.status(400).json({ error: 'Impossible de redimensionner un RDV groupé — les durées sont définies par les prestations' });
    }

    // Check practitioner availability (absences, exceptions, hours)
    const availCheckResize = await checkPracAvailability(bid, current.rows[0].practitioner_id, current.rows[0].start_at, end_at);
    if (!availCheckResize.ok) {
      return res.status(409).json({ error: availCheckResize.reason });
    }

    // Atomic resize: conflict check + update in one transaction
    const globalAllowOverlap = await businessAllowsOverlap(bid);
    const maxConcurrent = globalAllowOverlap ? Infinity : await getMaxConcurrent(bid, current.rows[0].practitioner_id);
    let resizeResult;
    try {
      resizeResult = await transactionWithRLS(bid, async (client) => {
        // Bug H6 fix: Re-check status inside transaction with FOR UPDATE
        const statusRecheck = await client.query(
          `SELECT status FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [id, bid]
        );
        if (statusRecheck.rows.length === 0 || ['cancelled', 'completed', 'no_show'].includes(statusRecheck.rows[0].status)) {
          throw Object.assign(new Error('Ce RDV ne peut plus être modifié'), { type: 'immutable' });
        }

        if (!globalAllowOverlap) {
          const conflicts = await checkBookingConflicts(client, { bid, pracId: current.rows[0].practitioner_id, newStart: current.rows[0].start_at, newEnd: end_at, excludeIds: id, movingProcTime: parseInt(current.rows[0].processing_time) || 0, movingProcStart: parseInt(current.rows[0].processing_start) || 0, movingBufferBefore: parseInt(current.rows[0].buffer_before_min) || 0 });
          if (conflicts.length >= maxConcurrent) {
            throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
          }
        }

        const r = await client.query(
          `UPDATE bookings SET end_at = $1, updated_at = NOW()
           WHERE id = $2 AND business_id = $3 AND status NOT IN ('cancelled', 'completed', 'no_show')
           RETURNING id, start_at, end_at`,
          [end_at, id, bid]
        );

        // Audit log inside transaction for atomicity
        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'resize', $4, $5)`,
          [bid, req.user.id, id,
           JSON.stringify({ end_at: current.rows[0].end_at }),
           JSON.stringify({ end_at })]
        );

        return r;
      });
    } catch (err) {
      if (err.type === 'conflict' || err.type === 'immutable') return res.status(err.type === 'conflict' ? 409 : 400).json({ error: err.message });
      throw err;
    }

    broadcast(bid, 'booking_update', { action: 'resized' });
    // H-07 fix: invalidate minisite cache (slot redimensionné)
    try { invalidateMinisiteCache(bid); } catch (_) {}
    calSyncPush(bid, id).catch(() => {});
    res.json({ updated: true, booking: resizeResult.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/modify — Full modification by practitioner
// Handles: date, time, duration changes + optional client notification
// UI: Calendar → event detail → "Modifier horaire" section
// ============================================================
router.patch('/:id/modify', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    // STS-V12-007: UUID validation
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { start_at, end_at, notify, notify_channel } = req.body;
    // Bug M11 fix: normalize notify so "false" string is not truthy
    const shouldNotify = notify === true || notify === 'true';
    // CRT-15: Default notify_channel to 'email' when shouldNotify is true
    const effectiveChannel = notify_channel || (shouldNotify ? 'email' : null);
    // notify_channel: 'email' | 'sms' | 'both'

    const VALID_CHANNELS = ['email', 'sms', 'both'];
    if (effectiveChannel && !VALID_CHANNELS.includes(effectiveChannel)) {
      return res.status(400).json({ error: `Canal invalide. Valeurs : ${VALID_CHANNELS.join(', ')}` });
    }

    if (!start_at || !end_at) {
      return res.status(400).json({ error: 'start_at et end_at requis' });
    }
    if (isNaN(new Date(start_at).getTime()) || isNaN(new Date(end_at).getTime())) {
      return res.status(400).json({ error: 'Format de date invalide' });
    }
    if (new Date(start_at) >= new Date(end_at)) {
      return res.status(400).json({ error: 'L\'heure de fin doit être après l\'heure de début' });
    }

    // Fetch old booking for audit + notification context
    const old = await queryWithRLS(bid,
      `SELECT b.*, c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
              s.category AS service_category,
              COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
              COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
              COALESCE(s.buffer_before_min, 0) AS svc_buffer_before,
              p.display_name AS practitioner_name,
              biz.name AS business_name, biz.slug, biz.theme, biz.address, biz.email AS business_email, biz.phone AS business_phone,
              biz.settings AS business_settings
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (old.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Guard: immutable statuses cannot be modified
    const IMMUTABLE_MOD = ['cancelled', 'completed', 'no_show'];
    if (IMMUTABLE_MOD.includes(old.rows[0].status)) {
      return res.status(400).json({ error: 'Ce RDV ne peut plus être modifié' });
    }
    const lockCheckMod = isBookingLocked(old.rows[0]);
    if (lockCheckMod.locked) {
      return res.status(400).json({ error: lockCheckMod.reason });
    }

    const oldBooking = old.rows[0];

    // CRT-V10-2: Block individual modify on grouped bookings
    if (oldBooking.group_id) {
      return res.status(400).json({ error: 'Impossible de modifier individuellement un RDV groupé. Utilisez le déplacement.' });
    }

    // Practitioner scope: can only modify own bookings
    if (req.practitionerFilter && String(oldBooking.practitioner_id) !== String(req.practitionerFilter)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }

    // Check practitioner availability (absences, exceptions, hours)
    const availCheckModify = await checkPracAvailability(bid, oldBooking.practitioner_id, start_at, end_at);
    if (!availCheckModify.ok) {
      return res.status(409).json({ error: availCheckModify.reason });
    }

    // BK-V13-002: newStatus is now computed inside the transaction using re-checked status

    // Atomic modify: conflict check + update in one transaction
    const globalAllowOverlap = await businessAllowsOverlap(bid);
    const maxConcurrent = globalAllowOverlap ? Infinity : await getMaxConcurrent(bid, oldBooking.practitioner_id);
    let modifyResult;
    try {
      modifyResult = await transactionWithRLS(bid, async (client) => {
        // Bug H6 fix: Re-check status inside transaction with FOR UPDATE
        const statusRecheck = await client.query(
          `SELECT status FROM bookings WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [id, bid]
        );
        if (statusRecheck.rows.length === 0 || ['cancelled', 'completed', 'no_show'].includes(statusRecheck.rows[0].status)) {
          throw Object.assign(new Error('Ce RDV ne peut plus être modifié'), { type: 'immutable' });
        }

        // BK-V13-002: Compute newStatus inside transaction using re-checked status to avoid stale data
        const recheckStatus = statusRecheck.rows[0].status;
        const modifyTimeMoved = new Date(oldBooking.start_at).getTime() !== new Date(start_at).getTime() || new Date(oldBooking.end_at).getTime() !== new Date(end_at).getTime();
        const newStatus = (shouldNotify && modifyTimeMoved)
          ? (recheckStatus === 'pending_deposit' ? 'pending_deposit' : 'modified_pending')
          : recheckStatus;

        if (!globalAllowOverlap) {
          const conflicts = await checkBookingConflicts(client, { bid, pracId: oldBooking.practitioner_id, newStart: start_at, newEnd: end_at, excludeIds: id, movingProcTime: parseInt(oldBooking.processing_time) || 0, movingProcStart: parseInt(oldBooking.processing_start) || 0, movingBufferBefore: parseInt(oldBooking.svc_buffer_before) || 0 });
          if (conflicts.length >= maxConcurrent) {
            throw Object.assign(new Error('Capacité maximale atteinte sur ce créneau'), { type: 'conflict' });
          }
        }

        const r = await client.query(
          // BUG-MODIFY-REMINDER fix: reset reminder_*_sent_at so the new slot gets its
          // 24h/2h rappels. Parity with /move (L644/L269) which already reset them.
          // BUG-MODIFY-CONFEXP fix: parity with /move — reset confirmation_expires_at
          // if booking was 'pending' (shouldNotify=false case). Without this, a /modify
          // without notify on a pending booking left the initial deadline (24h from creation)
          // in place → cron processExpiredPendingBookings would auto-cancel the new slot.
          `UPDATE bookings SET
            start_at = $1, end_at = $2, status = $3,
            reminder_24h_sent_at = NULL, reminder_2h_sent_at = NULL,
            confirmation_expires_at = CASE WHEN status = 'pending' THEN NULL ELSE confirmation_expires_at END,
            updated_at = NOW()
           WHERE id = $4 AND business_id = $5 AND status NOT IN ('cancelled', 'completed', 'no_show')
           RETURNING *`,
          [start_at, end_at, newStatus, id, bid]
        );

        // BUG-DEADLINE-PARITY fix (bombe #3) : utiliser computeDepositDeadline (parité
        // avec /move) au lieu de time-delta shift. Delta diverge si le salon a changé
        // deposit_deadline_hours entre le booking initial et ce /modify, OU si la
        // deadline initiale était au floor (20 min / 2h avant RDV). computeDepositDeadline
        // recalcule proprement à partir du nouveau start_at + settings actuels.
        const modified = r.rows[0];
        if (modified && modified.deposit_required && modified.deposit_deadline && modified.deposit_status === 'pending') {
          const { computeDepositDeadline } = require('../../routes/public/helpers');
          const _depBizModif = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [bid]);
          const newDeadline = computeDepositDeadline(new Date(start_at), _depBizModif.rows[0]?.settings || {}, modified.deposit_deadline);
          await client.query(
            `UPDATE bookings SET deposit_deadline = $1 WHERE id = $2 AND business_id = $3`,
            [newDeadline.toISOString(), id, bid]
          );
        }

        // H-13 fix: recalc LM discount + booked_price + sync invoice drafts après time change
        // (parité avec /move L671-774 — /modify changeait le time sans ces recalc).
        if (modified) {
          const bizResModify = await client.query(`SELECT plan, settings FROM businesses WHERE id = $1`, [bid]);
          const bizSettingsModify = bizResModify.rows[0]?.settings || {};
          if (bizSettingsModify.last_minute_enabled && (bizResModify.rows[0]?.plan || 'free') !== 'free') {
            const lmDeadlineModify = bizSettingsModify.last_minute_deadline || 'j-1';
            const newStartBrusselsModify = new Date(modified.start_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
            const todayBrusselsModify = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
            const inLmWindowModify = isWithinLastMinuteWindow(newStartBrusselsModify, todayBrusselsModify, lmDeadlineModify);
            const svcResModify = await client.query(
              `SELECT s.price_cents, s.promo_eligible, COALESCE(sv.price_cents, s.price_cents, 0) AS eff_price, s.quote_only
               FROM bookings b LEFT JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               WHERE b.id = $1`, [id]
            );
            const svcModify = svcResModify.rows[0];
            const lmMinPriceModify = bizSettingsModify.last_minute_min_price_cents || 0;
            let newDiscountPctModify = null;
            if (inLmWindowModify && svcModify && svcModify.promo_eligible !== false && svcModify.eff_price > 0 && svcModify.eff_price >= lmMinPriceModify) {
              newDiscountPctModify = bizSettingsModify.last_minute_discount_pct || 10;
            }
            await client.query(
              `UPDATE bookings SET discount_pct = $1 WHERE id = $2 AND business_id = $3`,
              [newDiscountPctModify, id, bid]
            );
            // Recalc booked_price_cents sauf quote_only (prix set manuellement)
            if (svcModify && !svcModify.quote_only) {
              const bookedPriceModify = newDiscountPctModify
                ? Math.round(svcModify.eff_price * (100 - newDiscountPctModify) / 100)
                : svcModify.eff_price;
              await client.query(
                `UPDATE bookings SET booked_price_cents = $1 WHERE id = $2 AND business_id = $3`,
                [bookedPriceModify, id, bid]
              );
            }
          }
          // Sync invoices drafts (parité H10)
          await syncDraftInvoicesForBookings(client, [id]);
        }

        const oldTimes = { start_at: oldBooking.start_at, end_at: oldBooking.end_at, status: oldBooking.status };
        const newTimes = { start_at, end_at, status: newStatus, notified: shouldNotify, channel: effectiveChannel };

        await client.query(
          `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
           VALUES ($1, $2, 'booking', $3, 'modify', $4, $5)`,
          [bid, req.user.id, id, JSON.stringify(oldTimes), JSON.stringify(newTimes)]
        );

        return r;
      });
    } catch (err) {
      if (err.type === 'conflict' || err.type === 'immutable') return res.status(err.type === 'conflict' ? 409 : 400).json({ error: err.message });
      throw err;
    }

    const result = modifyResult;

    // BUG-MODIFY-STALE fix: refetch booking AFTER tx — the tx does LM recalc + booked_price
    // update (L1544-1557) that aren't reflected in oldBooking (pre-tx snapshot). Without
    // this refetch, sendModificationEmail showed the OLD price even when the new slot
    // dropped out of LM window (e.g. 80€ LM → 100€ hors fenêtre → email still said 80€).
    let freshBk = null;
    try {
      const freshRes = await queryWithRLS(bid,
        `SELECT booked_price_cents, discount_pct, promotion_discount_cents, promotion_discount_pct, promotion_label,
                deposit_status, deposit_amount_cents, deposit_paid_at, deposit_deadline
           FROM bookings WHERE id = $1 AND business_id = $2`,
        [id, bid]
      );
      freshBk = freshRes.rows[0] || null;
    } catch (_) { /* fall back to oldBooking if fetch fails */ }

    // If notification requested, send it
    let notificationResult = null;
    if (shouldNotify && (effectiveChannel === 'email' || effectiveChannel === 'both')) {
      try {
        let groupServices = null;
        if (oldBooking.group_id) {
          const siblingsRes = await queryWithRLS(bid,
            `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name,
                    COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                    COALESCE(sv.price_cents, s.price_cents) AS price_cents,
                    b.discount_pct,
                    p.display_name AS practitioner_name
             FROM bookings b
             LEFT JOIN services s ON s.id = b.service_id
             LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
             JOIN practitioners p ON p.id = b.practitioner_id
             WHERE b.group_id = $1 AND b.business_id = $2
               AND b.status NOT IN ('cancelled')
             ORDER BY b.group_order`,
            [oldBooking.group_id, bid]
          );
          if (siblingsRes.rows.length > 1) {
            siblingsRes.rows.forEach(r => {
              if (r.discount_pct && r.price_cents) { r.original_price_cents = r.price_cents; r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100); }
            });
            groupServices = siblingsRes.rows;
          }
        }
        const emailResult = await sendModificationEmail({
          booking: {
            client_name: oldBooking.client_name,
            client_email: oldBooking.client_email,
            public_token: oldBooking.public_token,
            service_name: oldBooking.service_name,
            service_category: oldBooking.service_category,
            practitioner_name: oldBooking.practitioner_name,
            // H11 fix: pass raw + booked + discount_pct séparés pour que le template affiche LM barré
            // BUG-MODIFY-STALE fix: use freshBk (post-tx values) for booked_price, discount_pct,
            // promo and deposit — oldBooking is pre-tx and misses LM recalc changes.
            // IMPORTANT: use a single `_modBk` source (freshBk if fetch OK, else oldBooking) —
            // `??` fallback breaks when discount_pct goes to null (out-of-LM-window recalc).
            service_price_cents: oldBooking.service_price_cents,
            booked_price_cents: (freshBk ? freshBk.booked_price_cents : oldBooking.booked_price_cents),
            discount_pct: (freshBk ? freshBk.discount_pct : oldBooking.discount_pct),
            duration_min: oldBooking.duration_min,
            promotion_label: (freshBk ? freshBk.promotion_label : oldBooking.promotion_label),
            promotion_discount_cents: (freshBk ? freshBk.promotion_discount_cents : oldBooking.promotion_discount_cents),
            promotion_discount_pct: (freshBk ? freshBk.promotion_discount_pct : oldBooking.promotion_discount_pct),
            deposit_status: (freshBk ? freshBk.deposit_status : oldBooking.deposit_status),
            deposit_amount_cents: (freshBk ? freshBk.deposit_amount_cents : oldBooking.deposit_amount_cents),
            deposit_paid_at: (freshBk ? freshBk.deposit_paid_at : oldBooking.deposit_paid_at),
            deposit_deadline: (freshBk ? freshBk.deposit_deadline : oldBooking.deposit_deadline),
            old_start_at: oldBooking.start_at,
            old_end_at: oldBooking.end_at,
            new_start_at: start_at,
            new_end_at: end_at
          },
          business: {
            id: bid,
            name: oldBooking.business_name,
            email: oldBooking.business_email,
            phone: oldBooking.business_phone,
            theme: oldBooking.theme || {},
            address: oldBooking.address,
            settings: oldBooking.business_settings
          },
          groupServices
        });
        notificationResult = { email: emailResult.success ? 'sent' : 'error', detail: emailResult.error || emailResult.messageId };
      } catch (e) {
        console.warn('Email notification error:', e.message);
        notificationResult = { email: 'error', detail: e.message };
      }
    }
    if (shouldNotify && (effectiveChannel === 'sms' || effectiveChannel === 'both') && oldBooking.client_phone) {
      try {
        const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
        const manageLink = `${baseUrl}/booking/${oldBooking.public_token}`;
        const newDateStr = new Date(start_at).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
        const newTimeStr = new Date(start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
        const timeMoved = new Date(oldBooking.start_at).getTime() !== new Date(start_at).getTime() || new Date(oldBooking.end_at).getTime() !== new Date(end_at).getTime();
        const _svcLabel = oldBooking.service_name || 'prestation';
        const smsBody = timeMoved
          ? `${oldBooking.business_name}: Votre RDV "${_svcLabel}" a été modifié — ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`
          : `${oldBooking.business_name}: Rappel, RDV "${_svcLabel}" le ${newDateStr} à ${newTimeStr}. Détails : ${manageLink}`;
        const smsResult = await sendSMS({ to: oldBooking.client_phone, body: smsBody, businessId: bid, clientId: oldBooking.client_id });
        notificationResult = { ...notificationResult, sms: smsResult.success ? 'sent' : 'error' };
      } catch (e) {
        console.warn('[MODIFY] SMS error:', e.message);
        notificationResult = { ...notificationResult, sms: 'error' };
      }
    }

    broadcast(bid, 'booking_update', { action: 'modified' });
    // H-07 fix: invalidate minisite cache (slot modifié)
    try { invalidateMinisiteCache(bid); } catch (_) {}
    calSyncPush(bid, id).catch(() => {});

    // BUG-MODIFY-WAITLIST fix: parité avec /move group (L608) + /move single (L948) + public /reschedule.
    // /modify déplace aussi le booking → l'ancien créneau est libéré → waitlist doit être notifiée.
    if (new Date(oldBooking.start_at).getTime() !== new Date(start_at).getTime()
      || new Date(oldBooking.end_at).getTime() !== new Date(end_at).getTime()) {
      try {
        const { processWaitlistForCancellation } = require('../../services/waitlist');
        await processWaitlistForCancellation(id, bid, { start_at: oldBooking.start_at, end_at: oldBooking.end_at });
      } catch (_) { /* best-effort */ }
    }

    res.json({
      updated: true,
      booking: result.rows[0],
      notification: notificationResult,
      modification: {
        old: { start: oldBooking.start_at, end: oldBooking.end_at },
        new: { start: start_at, end: end_at },
        status_changed: shouldNotify ? result.rows[0]?.status : null
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/reorder-group — Reorder services within a group
// UI: Booking detail modal → ↑/↓ buttons on group members
// ============================================================
router.patch('/:id/reorder-group', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    const { ordered_ids } = req.body;

    if (!Array.isArray(ordered_ids) || ordered_ids.length < 2) {
      return res.status(400).json({ error: 'ordered_ids requis (min 2)' });
    }
    if (ordered_ids.some(oid => !UUID_RE.test(oid))) {
      return res.status(400).json({ error: 'ordered_ids invalide(s)' });
    }

    // Fetch booking to get group_id
    const bkRes = await queryWithRLS(bid,
      `SELECT group_id FROM bookings WHERE id = $1 AND business_id = $2`, [id, bid]);
    if (bkRes.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const { group_id } = bkRes.rows[0];
    if (!group_id) return res.status(400).json({ error: 'Ce RDV ne fait pas partie d\'un groupe' });

    // Fetch all siblings with service durations
    const grpRes = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.end_at, b.group_order, b.status,
              s.duration_min, s.buffer_before_min, s.buffer_after_min
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       WHERE b.group_id = $1 AND b.business_id = $2
       ORDER BY b.group_order`,
      [group_id, bid]);
    const members = grpRes.rows;

    // Validate ordered_ids matches exactly the group members
    const memberIds = new Set(members.map(m => m.id));
    if (ordered_ids.length !== members.length || !ordered_ids.every(oid => memberIds.has(oid))) {
      return res.status(400).json({ error: 'ordered_ids ne correspond pas aux membres du groupe' });
    }

    // Build reordered list
    const memberMap = Object.fromEntries(members.map(m => [m.id, m]));
    const reordered = ordered_ids.map(oid => memberMap[oid]);

    // Recalculate chain: cursor starts at original first booking's start_at
    const chainStart = new Date(members[0].start_at);
    let cursor = new Date(chainStart);
    const updates = reordered.map((m, i) => {
      const origDur = (new Date(m.end_at).getTime() - new Date(m.start_at).getTime()) / 60000;
      const totalMin = m.duration_min != null
        ? ((i === 0) ? (m.buffer_before_min || 0) : 0) + m.duration_min + ((i === reordered.length - 1) ? (m.buffer_after_min || 0) : 0)
        : origDur;
      const s = new Date(cursor);
      const e = new Date(s.getTime() + totalMin * 60000);
      cursor = e;
      return { id: m.id, group_order: i, start_at: s.toISOString(), end_at: e.toISOString() };
    });

    await transactionWithRLS(bid, async (client) => {
      // Lock group members
      const lockRes = await client.query(
        `SELECT id, status FROM bookings WHERE group_id = $1 AND business_id = $2 FOR UPDATE`,
        [group_id, bid]);
      const IMMUTABLE = ['cancelled', 'completed', 'no_show'];
      if (lockRes.rows.some(r => IMMUTABLE.includes(r.status))) {
        throw Object.assign(new Error('Un membre du groupe ne peut plus être modifié'), { type: 'immutable' });
      }

      for (const u of updates) {
        await client.query(
          `UPDATE bookings SET group_order = $1, start_at = $2, end_at = $3, updated_at = NOW()
           WHERE id = $4 AND business_id = $5`,
          [u.group_order, u.start_at, u.end_at, u.id, bid]);
      }

      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
         VALUES ($1, $2, 'booking', $3, 'group_reorder', $4, $5)`,
        [bid, req.user.id, id,
         JSON.stringify({ old_order: members.map(m => m.id) }),
         JSON.stringify({ new_order: ordered_ids })]);
    });

    broadcast(bid, 'booking_update', { action: 'reordered' });
    res.json({ updated: true, count: updates.length });
  } catch (err) {
    if (err.type === 'immutable') return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// POST /api/bookings/:id/send-reminder — Manual reminder (SMS/email/both)
// UI: Booking detail modal → "Envoyer un rappel" button
// ============================================================
router.post('/:id/send-reminder', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { channel } = req.body; // 'sms' | 'email' | 'both'
    if (!channel || !['sms', 'email', 'both'].includes(channel)) {
      return res.status(400).json({ error: 'channel requis: sms, email ou both' });
    }

    const bk = await queryWithRLS(bid,
      `SELECT b.*, c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
              CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS service_name,
              COALESCE(sv.duration_min, s.duration_min) AS svc_duration_min,
              COALESCE(sv.price_cents, s.price_cents) AS svc_price_cents,
              p.display_name AS practitioner_name,
              biz.name AS business_name, biz.slug, biz.theme, biz.address, biz.email AS business_email, biz.phone AS business_phone,
              biz.settings AS business_settings
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );
    if (bk.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const b = bk.rows[0];

    if (['cancelled', 'no_show'].includes(b.status)) {
      return res.status(400).json({ error: 'Impossible de notifier un RDV annulé' });
    }

    // Anti-spam: max 1 manual reminder per 30 minutes per booking
    const recentReminder = await queryWithRLS(bid,
      `SELECT id FROM notifications
       WHERE booking_id = $1 AND business_id = $2 AND type = 'manual_reminder'
         AND sent_at > NOW() - INTERVAL '30 minutes'
       LIMIT 1`,
      [id, bid]
    );
    if (recentReminder.rows.length > 0) {
      return res.status(429).json({ error: 'Un rappel a déjà été envoyé récemment. Veuillez patienter.' });
    }

    const dateStr = new Date(b.start_at).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
    const timeStr = new Date(b.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
    const endTimeStr = b.end_at ? new Date(b.end_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : null;
    const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
    const manageUrl = `${baseUrl}/booking/${b.public_token}`;
    const result = {};

    if ((channel === 'sms' || channel === 'both') && b.client_phone) {
      // Plan gate — SMS reserved to pro plan, parity with reminders.js cron
      const _planRow = await queryWithRLS(bid, `SELECT plan FROM businesses WHERE id = $1`, [bid]);
      const _bizPlan = _planRow.rows[0]?.plan || 'free';
      if (_bizPlan === 'free') {
        result.sms = 'skipped';
        result.sms_error = 'plan_free_no_sms';
      } else {
        const smsBody = `Rappel ${b.business_name}: RDV "${b.service_name}" le ${dateStr} à ${timeStr} avec ${b.practitioner_name}. Détails : ${manageUrl}`;
        const smsRes = await sendSMS({ to: b.client_phone, body: smsBody, businessId: bid, clientId: b.client_id });
        result.sms = smsRes.success ? 'sent' : 'error';
        if (smsRes.error) result.sms_error = smsRes.error;
      }
    }

    if ((channel === 'email' || channel === 'both') && b.client_email) {
      try {
        const { buildEmailHTML, sendEmail, escHtml } = require('../../services/email');
        const primaryColor = (b.theme && b.theme.primary_color) || '#2A7B7F';

        // Fetch group siblings if this is a group booking
        let groupServices = null;
        if (b.group_id) {
          const grp = await queryWithRLS(bid,
            `SELECT CASE WHEN sv.name IS NOT NULL THEN s.name || ' — ' || sv.name ELSE s.name END AS name,
                    COALESCE(sv.duration_min, s.duration_min) AS duration_min,
                    COALESCE(sv.price_cents, s.price_cents) AS price_cents,
                    b2.discount_pct
             FROM bookings b2
             LEFT JOIN services s ON s.id = b2.service_id
             LEFT JOIN service_variants sv ON sv.id = b2.service_variant_id
             WHERE b2.group_id = $1 AND b2.business_id = $2
             ORDER BY b2.group_order, b2.start_at`,
            [b.group_id, bid]
          );
          if (grp.rows.length > 1) {
            // Apply last-minute discount to each group member's price
            grp.rows.forEach(r => {
              if (r.discount_pct && r.price_cents) {
                r.original_price_cents = r.price_cents;
                r.price_cents = Math.round(r.price_cents * (100 - r.discount_pct) / 100);
              }
            });
            groupServices = grp.rows;
          }
        }

        const isMulti = Array.isArray(groupServices) && groupServices.length > 1;
        const promoDiscount = parseInt(b.promotion_discount_cents) || 0;
        const promoLabel = b.promotion_label || '';
        let serviceBlock;

        if (isMulti) {
          // Group booking: list all services
          let serviceHTML = groupServices.map(s => {
            const price = s.price_cents ? ' · ' + (s.price_cents / 100).toFixed(2).replace('.', ',') + ' €' : '';
            return `<div style="padding:2px 0;font-weight:600">• ${escHtml(s.name)} (${s.duration_min} min${price})</div>`;
          }).join('');
          const totalMin = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
          const totalPrice = groupServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
          const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
          if (totalPrice > 0 && promoDiscount > 0 && promoLabel) {
            const finalPrice = totalPrice - promoDiscount;
            serviceHTML += `<div style="padding:4px 0;font-weight:700">Total : ${durStr} · <s style="opacity:.6">${(totalPrice / 100).toFixed(2).replace('.', ',')} €</s> ${(finalPrice / 100).toFixed(2).replace('.', ',')} €</div>`;
            serviceHTML += `<div style="padding:2px 0;font-size:12px;color:#7A7470">${escHtml(promoLabel)} : -${(promoDiscount / 100).toFixed(2).replace('.', ',')} €</div>`;
          } else {
            const totalPriceStr = totalPrice > 0 ? ' · ' + (totalPrice / 100).toFixed(2).replace('.', ',') + ' €' : '';
            serviceHTML += `<div style="padding:4px 0;font-weight:700">Total : ${durStr}${totalPriceStr}</div>`;
          }
          serviceBlock = serviceHTML;
        } else {
          // Single booking
          const durationMin = b.duration_min || b.svc_duration_min;
          const priceCents = b.price_cents || b.svc_price_cents;
          let priceHTML = '';
          if (priceCents) {
            if (promoDiscount > 0 && promoLabel) {
              const finalPrice = priceCents - promoDiscount;
              priceHTML = ` · <s style="opacity:.6">${(priceCents / 100).toFixed(2).replace('.', ',')} €</s> ${(finalPrice / 100).toFixed(2).replace('.', ',')} €`;
              priceHTML += `<div style="font-size:12px;color:#7A7470">${escHtml(promoLabel)} : -${(promoDiscount / 100).toFixed(2).replace('.', ',')} €</div>`;
            } else {
              priceHTML = ` · ${(priceCents / 100).toFixed(2).replace('.', ',')} €`;
            }
          }
          const durationHTML = durationMin ? ` (${durationMin} min${priceHTML})` : (priceHTML ? ` (${priceHTML})` : '');
          serviceBlock = `<strong>${escHtml(b.service_name || 'Rendez-vous')}</strong>${durationHTML}`;
        }

        const addressLine = b.appointment_mode === 'cabinet' && b.address
          ? `<br><a href="https://maps.google.com/?q=${encodeURIComponent(b.address)}" style="color:inherit;text-decoration:underline">${escHtml(b.address)}</a>` : '';
        const contactParts = [];
        if (b.business_phone) contactParts.push(escHtml(b.business_phone));
        if (b.business_email) contactParts.push(escHtml(b.business_email));
        const contactLine = contactParts.length > 0 ? `<p style="font-size:13px;color:#9C958E;margin-top:8px">${contactParts.join(' \u00b7 ')}</p>` : '';

        const html = buildEmailHTML({
          businessName: b.business_name, primaryColor,
          title: 'Rappel de votre rendez-vous',
          bodyHTML: `<p>Bonjour <strong>${escHtml(b.client_name || '')}</strong>,</p><p>Ceci est un rappel pour votre rendez-vous :</p><div style="background:#F4F1EE;border-radius:8px;padding:14px 16px;margin:12px 0">${serviceBlock}<br>${escHtml(dateStr)} à ${escHtml(timeStr)}${endTimeStr ? ' – ' + escHtml(endTimeStr) : ''}<br>avec ${escHtml(b.practitioner_name || '')}${addressLine}</div>${contactLine}`,
          ctaText: 'Voir mon rendez-vous', ctaUrl: manageUrl,
          cancelText: 'Gérer mon rendez-vous', cancelUrl: manageUrl,
          footerText: `${b.business_name}${b.address ? ' \u00b7 ' + b.address : ''} \u00b7 Via Genda.be`
        });
        await sendEmail({ to: b.client_email, subject: `Rappel : votre RDV du ${dateStr} à ${timeStr} — ${b.business_name}`, html, fromName: b.business_name, replyTo: b.business_email || null });
        result.email = 'sent';
      } catch (e) {
        console.warn('[REMINDER] Email error:', e.message);
        result.email = 'error';
      }
    }

    // Log notification
    await queryWithRLS(bid,
      `INSERT INTO notifications (business_id, booking_id, type, recipient_phone, recipient_email, status, sent_at)
       VALUES ($1, $2, 'manual_reminder', $3, $4, 'sent', NOW())`,
      [bid, id, b.client_phone || null, b.client_email || null]
    );

    res.json({ sent: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
