const router = require('express').Router();
const { query, queryWithRLS, pool } = require('../../services/db');
const { getAvailableSlots, getAvailableSlotsMultiPractitioner } = require('../../services/slot-engine');
const { bookingLimiter, slotsLimiter, depositLimiter } = require('../../middleware/rate-limiter');
const { processWaitlistForCancellation } = require('../../services/waitlist');
const { broadcast } = require('../../services/sse');
const { sendBookingConfirmation } = require('../../services/email');
const { checkPracAvailability, checkBookingConflicts } = require('../staff/bookings-helpers');
const { UUID_RE, escHtml, stripeRefundDeposit, shouldRequireDeposit, computeDepositDeadline, isWithinLastMinuteWindow, BASE_URL, validateAndCalcPromo } = require('./helpers');

// Mount OAuth sub-router for client booking authentication
router.use('/auth', require('./oauth'));

// Sub-routers
router.use('/', require('./booking-export'));
router.use('/', require('./booking-lookup'));
router.use('/', require('./slots'));
router.use('/', require('./misc'));
router.use('/', require('./gift-cards-passes'));
router.use('/', require('./waitlist'));
router.use('/', require('./booking-reschedule'));
router.use('/', require('./deposit'));
router.use('/', require('./booking-actions'));

// ============================================================
// POST /api/public/:slug/bookings
// (unchanged from v1 — same booking creation logic)
// ============================================================
router.post('/:slug/bookings', bookingLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const {
      service_id, service_ids, practitioner_id, practitioners: splitPractitioners,
      start_at, end_at, appointment_mode,
      variant_id, variant_ids,
      client_name, client_phone, client_email, client_bce,
      client_comment, client_language, consent_sms, consent_email, consent_marketing,
      flexible, is_last_minute,
      oauth_provider, oauth_provider_id,
      gift_card_code,
      pass_code,
      promotion_id
    } = req.body;

    // Split mode: practitioners[] array provided instead of practitioner_id
    let isSplitMode = Array.isArray(splitPractitioners) && splitPractitioners.length > 0;

    if (!isSplitMode && !practitioner_id) {
      return res.status(400).json({ error: 'practitioner_id ou practitioners[] requis' });
    }
    if (!start_at || !client_name || !client_phone || !client_email) {
      return res.status(400).json({
        error: 'Champs requis : start_at, client_name, client_phone, client_email'
      });
    }

    if (typeof client_name !== 'string' || typeof client_email !== 'string') {
      return res.status(400).json({ error: 'Les champs client doivent être des chaînes de caractères' });
    }
    if (client_phone && typeof client_phone !== 'string') {
      return res.status(400).json({ error: 'Les champs client doivent être des chaînes de caractères' });
    }

    // M4: Validate oauth_provider if provided
    const VALID_OAUTH_PROVIDERS = ['google', 'facebook', 'apple', 'microsoft'];
    if (oauth_provider && (!VALID_OAUTH_PROVIDERS.includes(oauth_provider) || typeof oauth_provider !== 'string')) {
      return res.status(400).json({ error: 'oauth_provider invalide' });
    }
    if (oauth_provider_id && (typeof oauth_provider_id !== 'string' || oauth_provider_id.length > 500)) {
      return res.status(400).json({ error: 'oauth_provider_id invalide' });
    }

    if (!isSplitMode && !UUID_RE.test(practitioner_id)) {
      return res.status(400).json({ error: 'practitioner_id invalide' });
    }
    if (isSplitMode) {
      for (const sp of splitPractitioners) {
        if (!sp.service_id || !sp.practitioner_id || !UUID_RE.test(sp.service_id) || !UUID_RE.test(sp.practitioner_id)) {
          return res.status(400).json({ error: 'practitioners[]: service_id et practitioner_id requis (UUID)' });
        }
      }
    }
    if (service_id && !UUID_RE.test(service_id)) {
      return res.status(400).json({ error: 'service_id invalide' });
    }

    // Multi-service: normalize service_ids
    // - service_ids with > 1 element → multi-service flow
    // - service_ids with exactly 1 element → treat as single service_id
    // - service_id (singular) only → existing behavior
    let isMultiService = false;
    let effectiveServiceId = service_id; // used for single-service path
    if (Array.isArray(service_ids) && service_ids.length > 1) {
      if (service_ids.length > 5) {
        return res.status(400).json({ error: 'Maximum 5 prestations par réservation groupée' });
      }
      if (service_ids.some(id => !UUID_RE.test(id))) {
        return res.status(400).json({ error: 'service_ids invalide(s)' });
      }
      // No dedup on service_ids: a client may book the same service multiple times (e.g. [A, A])
      isMultiService = true;
    } else if (Array.isArray(service_ids) && service_ids.length === 1) {
      // Treat single-element array as regular single service
      if (!UUID_RE.test(service_ids[0])) {
        return res.status(400).json({ error: 'service_ids invalide(s)' });
      }
      effectiveServiceId = service_ids[0];
    }

    // Bug B1 fix: length limits on client fields
    if (client_name && client_name.length > 200) return res.status(400).json({ error: 'Nom trop long (max 200)' });
    if (client_email && client_email.length > 320) return res.status(400).json({ error: 'Email trop long' });
    if (client_phone && client_phone.length > 30) return res.status(400).json({ error: 'Téléphone trop long' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(client_email)) return res.status(400).json({ error: 'Format email invalide' });
    if (client_phone && !/^\+?[\d\s\-().]{6,}$/.test(client_phone)) return res.status(400).json({ error: 'Format téléphone invalide' });

    const VALID_MODES = ['cabinet', 'visio', 'phone', 'domicile'];
    if (appointment_mode && !VALID_MODES.includes(appointment_mode)) {
      return res.status(400).json({ error: 'Mode de rendez-vous invalide' });
    }

    if (client_comment && (typeof client_comment !== 'string' || client_comment.length > 500)) {
      return res.status(400).json({ error: 'Commentaire invalide (max 500 caractères)' });
    }

    if (client_bce && (typeof client_bce !== 'string' || client_bce.length > 30)) {
      return res.status(400).json({ error: 'Numéro BCE invalide (max 30 caractères)' });
    }

    const VALID_LANGS = ['fr', 'nl', 'en', 'de', 'unknown'];
    const safeLang = VALID_LANGS.includes(client_language) ? client_language : 'unknown';

    const bizResult = await query(
      `SELECT id, settings FROM businesses WHERE slug = $1 AND is_active = true`, [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Cabinet introuvable' });

    const businessId = bizResult.rows[0].id;
    const bizSettings = bizResult.rows[0].settings || {};
    const { transactionWithRLS } = require('../../services/db');

    // Multi-service: check if enabled
    if (isMultiService && !bizSettings.multi_service_enabled) {
      return res.status(400).json({ error: 'La réservation multi-prestations n\'est pas activée pour ce cabinet' });
    }

    const startDate = new Date(start_at);
    if (isNaN(startDate.getTime())) return res.status(400).json({ error: 'Date de début invalide' });
    // PUB-V12-012: This comparison is correct — Date objects normalize to UTC internally, so timezone is not a concern here
    if (startDate < new Date()) return res.status(400).json({ error: 'Impossible de réserver dans le passé' });

    // ── Locked-week guard: reject non-featured bookings when week is locked ──
    // For split mode, check all involved practitioners
    const startDateBrussels = startDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const lockCheckPracIds = isSplitMode
      ? [...new Set(splitPractitioners.map(sp => sp.practitioner_id))]
      : [practitioner_id];
    for (const lockPracId of lockCheckPracIds) {
      const lockCheck = await query(
        `SELECT 1 FROM locked_weeks
         WHERE business_id = $1 AND practitioner_id = $2
         AND week_start = date_trunc('week', $3::date)::date`,
        [businessId, lockPracId, startDateBrussels]
      );
      if (lockCheck.rows.length > 0) {
        const startTimeStr = startDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
        const fsCheck = await query(
          `SELECT 1 FROM featured_slots
           WHERE business_id = $1 AND practitioner_id = $2
           AND date = $3::date AND to_char(start_time, 'HH24:MI') = $4`,
          [businessId, lockPracId, startDateBrussels, startTimeStr]
        );
        if (fsCheck.rows.length === 0) {
          return res.status(403).json({
            error: 'Cette semaine est verrouillée. Seuls les créneaux vedette sont disponibles.'
          });
        }
      }
    }

    // ══════════════════════════════════════════════════════════
    // MULTI-SERVICE BOOKING FLOW
    // ══════════════════════════════════════════════════════════
    if (isMultiService) {
      // Fetch all unique services, then expand to match order (supports duplicates — BUG-m5)
      const uniqueServiceIds = [...new Set(service_ids)];
      const multiSvcResult = await query(
        `SELECT id, name, category, duration_min, buffer_before_min, buffer_after_min, mode_options, price_cents, processing_time, processing_start, flexibility_enabled
         FROM services WHERE id = ANY($1) AND business_id = $2 AND is_active = true AND bookable_online = true`,
        [uniqueServiceIds, businessId]
      );
      const svcById = {};
      multiSvcResult.rows.forEach(r => { svcById[r.id] = r; });
      const missingIds = service_ids.filter(id => !svcById[id]);
      if (missingIds.length > 0) {
        return res.status(404).json({ error: `Prestation(s) introuvable(s): ${[...new Set(missingIds)].join(', ')}` });
      }
      // Rebuild ordered list (with duplicates if any)
      let multiServices = service_ids.map(id => ({ ...svcById[id] }));

      // Resolve variant overrides for duration/price (multi-service)
      const resolvedVariantIds = [];
      if (Array.isArray(variant_ids) && variant_ids.length > 0) {
        for (let i = 0; i < multiServices.length; i++) {
          const vid = variant_ids[i];
          if (vid && UUID_RE.test(vid)) {
            const vr = await queryWithRLS(businessId,
              `SELECT name, duration_min, price_cents, processing_time, processing_start FROM service_variants
               WHERE id = $1 AND service_id = $2 AND business_id = $3 AND is_active = true`,
              [vid, multiServices[i].id, businessId]
            );
            if (vr.rows.length === 0) return res.status(404).json({ error: `Variante introuvable: ${vid}` });
            multiServices[i]._variant_name = vr.rows[0].name;
            multiServices[i].duration_min = vr.rows[0].duration_min;
            if (vr.rows[0].price_cents != null) multiServices[i].price_cents = vr.rows[0].price_cents;
            multiServices[i]._processing_time = vr.rows[0].processing_time || 0;
            multiServices[i]._processing_start = vr.rows[0].processing_start || 0;
            resolvedVariantIds.push(vid);
          } else {
            resolvedVariantIds.push(null);
          }
        }
      }

      // Preserve frontend order (matches slot engine which uses array_position)

      // Mode validation
      if (appointment_mode) {
        for (const svc of multiServices) {
          if (!(svc.mode_options || []).includes(appointment_mode)) {
            return res.status(400).json({ error: `Mode "${appointment_mode}" non disponible pour la prestation ${svc.id}` });
          }
        }
      }

      // Build practitioners map for split mode
      const splitPracMap = {}; // service_id → practitioner_id
      if (isSplitMode) {
        for (const sp of splitPractitioners) {
          splitPracMap[sp.service_id] = sp.practitioner_id;
        }
        // Validate each practitioner offers their respective service
        for (const svc of multiServices) {
          const pracId = splitPracMap[svc.id];
          if (!pracId) {
            return res.status(400).json({ error: `Praticien manquant pour la prestation ${svc.id}` });
          }
          const psCheck = await query(
            `SELECT 1 FROM practitioner_services WHERE service_id = $1 AND practitioner_id = $2`,
            [svc.id, pracId]
          );
          if (psCheck.rows.length === 0) {
            return res.status(400).json({ error: `Le praticien ${pracId} ne propose pas la prestation ${svc.name}` });
          }
        }
        // Validate all practitioners are active + booking_enabled
        const uniquePracIds = [...new Set(Object.values(splitPracMap))];
        for (const pid of uniquePracIds) {
          const pracCheck = await query(
            `SELECT is_active, booking_enabled FROM practitioners WHERE id = $1 AND business_id = $2`,
            [pid, businessId]
          );
          if (pracCheck.rows.length === 0 || !pracCheck.rows[0].is_active || !pracCheck.rows[0].booking_enabled) {
            return res.status(400).json({ error: 'Un praticien n\'est pas disponible pour la prise de rendez-vous' });
          }
        }
      } else {
        // Mono-practitioner: validate offers ALL services
        const psMultiCheck = await query(
          `SELECT COUNT(DISTINCT service_id)::int AS cnt
           FROM practitioner_services WHERE service_id = ANY($1) AND practitioner_id = $2`,
          [service_ids, practitioner_id]
        );
        if (!psMultiCheck.rows[0] || psMultiCheck.rows[0].cnt !== service_ids.length) {
          // Auto-split: practitioner doesn't cover all services, assign each service to a valid practitioner
          console.log('[BOOKING] Auto-split: practitioner', practitioner_id, 'does not cover all services, falling back to split mode');
          const autoSplitResult = await query(
            `SELECT DISTINCT ON (ps.service_id) ps.service_id, ps.practitioner_id
             FROM practitioner_services ps
             JOIN practitioners p ON p.id = ps.practitioner_id
             WHERE ps.service_id = ANY($1) AND p.business_id = $2 AND p.is_active = true AND p.booking_enabled = true
             ORDER BY ps.service_id, (ps.practitioner_id = $3) DESC, p.display_order ASC`,
            [service_ids, businessId, practitioner_id]
          );
          if (autoSplitResult.rows.length !== service_ids.length) {
            return res.status(400).json({ error: 'Impossible de trouver un praticien pour chaque prestation' });
          }
          // Switch to split mode
          isSplitMode = true;
          for (const row of autoSplitResult.rows) {
            splitPracMap[row.service_id] = row.practitioner_id;
          }
          // Validate all auto-assigned practitioners
          const autoUniquePracIds = [...new Set(autoSplitResult.rows.map(r => r.practitioner_id))];
          for (const pid of autoUniquePracIds) {
            const pracCheck = await query(
              `SELECT is_active, booking_enabled FROM practitioners WHERE id = $1 AND business_id = $2`,
              [pid, businessId]
            );
            if (pracCheck.rows.length === 0 || !pracCheck.rows[0].is_active || !pracCheck.rows[0].booking_enabled) {
              return res.status(400).json({ error: 'Un praticien n\'est pas disponible pour la prise de rendez-vous' });
            }
          }
        } else {
          // Validate practitioner is active + booking_enabled + capacity
          const multiPracCap = await query(
            `SELECT COALESCE(max_concurrent, 1) AS max_concurrent, is_active, booking_enabled
             FROM practitioners WHERE id = $1 AND business_id = $2`,
            [practitioner_id, businessId]
          );
          if (multiPracCap.rows.length === 0 || !multiPracCap.rows[0].is_active || !multiPracCap.rows[0].booking_enabled) {
            return res.status(400).json({ error: 'Ce praticien n\'est pas disponible pour la prise de rendez-vous' });
          }
        }
      }

      // Calculate chained slots (buffer_before first only, buffer_after last only)
      const groupId = require('crypto').randomUUID();
      let cursor = new Date(startDate);
      const chainedSlots = multiServices.map((svc, i) => {
        const bufBefore = (i === 0) ? (svc.buffer_before_min || 0) : 0;
        const bufAfter = (i === multiServices.length - 1) ? (svc.buffer_after_min || 0) : 0;
        const totalDur = bufBefore + svc.duration_min + bufAfter;
        const slotStart = new Date(cursor);
        const slotEnd = new Date(slotStart.getTime() + totalDur * 60000);
        cursor = slotEnd;
        return {
          service_id: svc.id,
          service_variant_id: resolvedVariantIds[i] || null,
          practitioner_id: isSplitMode ? splitPracMap[svc.id] : practitioner_id,
          start_at: slotStart.toISOString(),
          end_at: slotEnd.toISOString(),
          group_order: i,
          processing_time: svc._processing_time || svc.processing_time || 0,
          processing_start: svc._processing_start || svc.processing_start || 0
        };
      });

      const totalEnd = new Date(chainedSlots[chainedSlots.length - 1].end_at);

      // Validate booking fits within practitioner availability
      if (isSplitMode) {
        // Split: check each practitioner for their specific time slice
        for (const slot of chainedSlots) {
          const availCheck = await checkPracAvailability(businessId, slot.practitioner_id, new Date(slot.start_at), new Date(slot.end_at));
          if (!availCheck.ok) {
            return res.status(400).json({ error: availCheck.reason });
          }
        }
      } else {
        const availCheck = await checkPracAvailability(businessId, practitioner_id, startDate, totalEnd);
        if (!availCheck.ok) {
          return res.status(400).json({ error: availCheck.reason });
        }
      }

      const multiResult = await transactionWithRLS(businessId, async (client) => {
        // Booking confirmation setting
        const _bizConf = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [businessId]);
        const _bizSettings = _bizConf.rows[0]?.settings || {};
        const needsConfirmation = !!_bizSettings.booking_confirmation_required;
        const bookingStatus = needsConfirmation ? 'pending' : 'confirmed';
        const confirmTimeoutMin = parseInt(_bizSettings.booking_confirmation_timeout_min) || 30;
        const confirmChannel = _bizSettings.booking_confirmation_channel || 'email';

        // Conflict check
        if (isSplitMode) {
          // Split: check conflicts per practitioner for their specific time slice
          for (const slot of chainedSlots) {
            const pracCap = await client.query(
              `SELECT COALESCE(max_concurrent, 1) AS max_concurrent FROM practitioners WHERE id = $1`,
              [slot.practitioner_id]
            );
            const maxConc = pracCap.rows[0]?.max_concurrent ?? 1;
            const conflicts = await checkBookingConflicts(client, { bid: businessId, pracId: slot.practitioner_id, newStart: slot.start_at, newEnd: slot.end_at });
            if (conflicts.length >= maxConc) {
              throw Object.assign(new Error('Ce créneau vient d\'être pris.'), { type: 'conflict' });
            }
          }
        } else {
          const multiPracCapRow = await client.query(
            `SELECT COALESCE(max_concurrent, 1) AS max_concurrent FROM practitioners WHERE id = $1`,
            [practitioner_id]
          );
          const multiMaxConcurrent = multiPracCapRow.rows[0]?.max_concurrent ?? 1;
          const conflicts = await checkBookingConflicts(client, { bid: businessId, pracId: practitioner_id, newStart: startDate.toISOString(), newEnd: totalEnd.toISOString() });
          if (conflicts.length >= multiMaxConcurrent) {
            throw Object.assign(new Error('Ce créneau vient d\'être pris.'), { type: 'conflict' });
          }
        }

        // Find or create client (4-step matching: OAuth > exact > phone > email)
        let clientId;
        let existingClient = null;
        let matchType = null;

        // Priority 1: OAuth provider match (most reliable identity)
        if (oauth_provider && oauth_provider_id) {
          const oauthMatch = await client.query(
            `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND oauth_provider = $2 AND oauth_provider_id = $3 LIMIT 1`,
            [businessId, oauth_provider, oauth_provider_id]
          );
          if (oauthMatch.rows.length > 0) {
            existingClient = oauthMatch.rows[0];
            matchType = 'oauth';
          }
        }

        // Priority 2-4: phone+email > phone > email
        if (!existingClient) {
          const exactMatch = await client.query(
            `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND phone = $2 AND LOWER(email) = LOWER($3) LIMIT 1`,
            [businessId, client_phone, client_email]
          );
          if (exactMatch.rows.length > 0) {
            existingClient = exactMatch.rows[0];
            matchType = 'exact';
          } else {
            const phoneMatch = await client.query(
              `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND phone = $2 LIMIT 1`,
              [businessId, client_phone]
            );
            if (phoneMatch.rows.length > 0) {
              existingClient = phoneMatch.rows[0];
              matchType = 'phone';
            } else {
              const emailMatch = await client.query(
                `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
                [businessId, client_email]
              );
              if (emailMatch.rows.length > 0) {
                existingClient = emailMatch.rows[0];
                matchType = 'email';
              }
            }
          }
        }

        if (existingClient) {
          if (existingClient.is_blocked) {
            throw Object.assign(
              new Error('Votre compte est temporairement suspendu. Veuillez contacter le cabinet directement.'),
              { type: 'blocked', status: 403 }
            );
          }
          clientId = existingClient.id;
          if (matchType === 'oauth' || matchType === 'exact') {
            // Only fill empty fields — merchant edits in dashboard take priority
            await client.query(
              `UPDATE clients SET
                full_name = COALESCE(full_name, NULLIF($1, '')),
                email = COALESCE(email, NULLIF($2, '')),
                phone = COALESCE(phone, NULLIF($3, '')),
                bce_number = COALESCE($4, bce_number),
                consent_sms = COALESCE($5, consent_sms),
                consent_email = COALESCE($6, consent_email),
                consent_marketing = COALESCE($7, consent_marketing),
                oauth_provider = COALESCE($9, oauth_provider),
                oauth_provider_id = COALESCE($10, oauth_provider_id),
                updated_at = NOW()
               WHERE id = $8`,
              [client_name, client_email, client_phone, client_bce,
               consent_sms === true ? true : (consent_sms === false ? false : null),
               consent_email === true ? true : (consent_email === false ? false : null),
               consent_marketing === true ? true : (consent_marketing === false ? false : null),
               clientId,
               oauth_provider || null, oauth_provider_id || null]
            );
          } else if (matchType === 'phone' || matchType === 'email') {
            // Soft merge: only fill empty fields — merchant edits take priority
            await client.query(
              `UPDATE clients SET
                full_name = COALESCE(full_name, NULLIF($2, '')),
                phone = COALESCE(phone, NULLIF($4, '')),
                email = COALESCE(email, NULLIF($5, '')),
                oauth_provider = COALESCE($6, oauth_provider),
                oauth_provider_id = COALESCE($7, oauth_provider_id),
                updated_at = NOW()
               WHERE id = $1 AND business_id = $3`,
              [clientId, client_name, businessId, client_phone || null, client_email || null, oauth_provider || null, oauth_provider_id || null]
            );
          }
        } else {
          const nc = await client.query(
            `INSERT INTO clients (business_id, full_name, phone, email, bce_number,
              language_preference, consent_sms, consent_email, consent_marketing, created_from,
              oauth_provider, oauth_provider_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'booking',$10,$11) RETURNING id`,
            [businessId, client_name, client_phone, client_email, client_bce||null,
             safeLang, consent_sms===true, consent_email===true, consent_marketing===true,
             oauth_provider || null, oauth_provider_id || null]
          );
          clientId = nc.rows[0].id;
        }

        // ── Promo validation (multi-service) ──
        const isNewClient = !existingClient;
        let promoResult = { valid: false };
        if (promotion_id && UUID_RE.test(promotion_id)) {
          const cartServiceIds = multiServices.map(s => s.id);
          const cartTotal = multiServices.reduce((sum, s) => sum + (s.price_cents || 0), 0);
          const servicePrices = {};
          multiServices.forEach(s => { servicePrices[s.id] = s.price_cents || 0; });
          promoResult = await validateAndCalcPromo(client, businessId, promotion_id, cartServiceIds, cartTotal, isNewClient, clientId, servicePrices);
        }

        // Determine locked status based on flexibility
        const anyFlexEnabled = multiServices.some(s => s.flexibility_enabled);
        const multiLocked = anyFlexEnabled ? (flexible !== true) : false;

        // Resolve last-minute discount per service (multi-service)
        let multiDiscountPct = null;
        if (is_last_minute && bizSettings.last_minute_enabled) {
          const lmDeadline = bizSettings.last_minute_deadline || 'j-1';
          const todayBrussels = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
          if (isWithinLastMinuteWindow(startDateBrussels, todayBrussels, lmDeadline)) {
            multiDiscountPct = bizSettings.last_minute_discount_pct || 10;
          }
        }

        // Insert each booking with group_id and group_order
        const bookings = [];
        for (const slot of chainedSlots) {
          const slotPracId = slot.practitioner_id || practitioner_id;
          // Per-service discount eligibility check
          let slotDiscount = null;
          if (multiDiscountPct) {
            const _pe = await client.query(`SELECT promo_eligible, price_cents FROM services WHERE id = $1`, [slot.service_id]);
            if (_pe.rows[0]?.promo_eligible !== false) {
              const lmMinPrice = bizSettings.last_minute_min_price_cents || 0;
              let effPrice = _pe.rows[0]?.price_cents || 0;
              if (slot.service_variant_id) {
                const _vp = await client.query(`SELECT price_cents FROM service_variants WHERE id = $1`, [slot.service_variant_id]);
                if (_vp.rows[0]?.price_cents != null) effPrice = _vp.rows[0].price_cents;
              }
              if (effPrice > 0 && effPrice >= lmMinPrice) slotDiscount = multiDiscountPct;
            }
          }
          const bk = await client.query(
            `INSERT INTO bookings (business_id, practitioner_id, service_id, service_variant_id, client_id,
              channel, appointment_mode, start_at, end_at, status, comment_client,
              group_id, group_order, confirmation_expires_at, processing_time, processing_start, locked, discount_pct,
              promotion_id, promotion_label, promotion_discount_pct, promotion_discount_cents)
             VALUES ($1,$2,$3,$4,$5,'web',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
             RETURNING id, public_token, start_at, end_at, status, group_id, group_order, discount_pct,
                       promotion_id, promotion_label, promotion_discount_pct, promotion_discount_cents`,
            [businessId, slotPracId, slot.service_id, slot.service_variant_id, clientId,
             appointment_mode||'cabinet', slot.start_at, slot.end_at, bookingStatus,
             client_comment||null, groupId, slot.group_order,
             needsConfirmation ? new Date(Date.now() + confirmTimeoutMin * 60000).toISOString() : null,
             slot.processing_time || 0, slot.processing_start || 0, bookingStatus === 'confirmed' ? true : multiLocked,
             slotDiscount,
             slot.group_order === 0 && promoResult.valid ? promotion_id : null,
             slot.group_order === 0 && promoResult.valid ? promoResult.label : null,
             slot.group_order === 0 && promoResult.valid ? promoResult.discount_pct : null,
             slot.group_order === 0 && promoResult.valid ? promoResult.discount_cents : 0]
          );
          bookings.push(bk.rows[0]);
        }

        // Deposit check (multi-service) — triggers: price/duration thresholds OR no-show recidivist
        let gcPartialCents = 0;
        let bizSettings = {};
        if (bookings.length > 0) {
          try {
            await client.query('SAVEPOINT deposit_sp');

            // Get business settings
            const bizSettingsRow = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [businessId]);
            bizSettings = bizSettingsRow.rows[0]?.settings || {};

            // Get total price from DB (accurate, includes variants)
            const svcPriceResult = await client.query(
              `SELECT COALESCE(SUM(COALESCE(sv.price_cents, s.price_cents)), 0) AS total_price,
                      COALESCE(SUM(COALESCE(sv.duration_min, s.duration_min)), 0) AS total_duration
               FROM bookings b
               JOIN services s ON s.id = b.service_id
               LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
               WHERE b.id = ANY($1) AND b.business_id = $2`,
              [bookings.map(b => b.id), businessId]
            );
            const totalPrice = parseInt(svcPriceResult.rows[0]?.total_price) || 0;
            const totalDuration = parseInt(svcPriceResult.rows[0]?.total_duration) || 0;

            // Get no-show count + VIP status (0/false for new clients)
            let noShowCount = 0;
            let clientIsVip = false;
            if (clientId) {
              const nsRow = await client.query(`SELECT no_show_count, is_vip FROM clients WHERE id = $1`, [clientId]);
              noShowCount = nsRow.rows[0]?.no_show_count || 0;
              clientIsVip = !!nsRow.rows[0]?.is_vip;
            }

            const depResult = shouldRequireDeposit(bizSettings, totalPrice, totalDuration, noShowCount, clientIsVip);

            // Recalculate deposit amount on reduced price if promo applied
            const promoDiscountCents = promoResult.valid ? promoResult.discount_cents : 0;
            if (depResult.required && promoDiscountCents > 0) {
              const reducedPrice = Math.max(0, totalPrice - promoDiscountCents);
              if (bizSettings.deposit_type === 'fixed') {
                // Cap fixed deposit at reduced price
                if (depResult.depCents > reducedPrice) depResult.depCents = reducedPrice;
              } else {
                depResult.depCents = Math.round(reducedPrice * (bizSettings.deposit_percent || 50) / 100);
              }
              if (depResult.depCents <= 0) depResult.required = false;
            }

            // Pass auto-debit — only for the booking whose service matches the pass
            let passUsed = false;
            let passMatchedBookingId = null;
            if (pass_code || client_email) {
              try {
                const serviceIds = chainedSlots.map(s => s.service_id);
                const variantIds = chainedSlots.map(s => s.service_variant_id || null);
                let passRes;
                if (pass_code) {
                  passRes = await client.query(
                    `SELECT id, code, sessions_remaining, service_id, service_variant_id FROM passes
                     WHERE business_id = $1 AND code = $2 AND status = 'active' AND sessions_remaining > 0
                       AND (expires_at IS NULL OR expires_at > NOW())
                     LIMIT 1`,
                    [businessId, pass_code.toUpperCase().trim()]
                  );
                } else if (client_email) {
                  passRes = await client.query(
                    `SELECT id, code, sessions_remaining, service_id, service_variant_id FROM passes
                     WHERE business_id = $1 AND status = 'active' AND sessions_remaining > 0
                       AND LOWER(buyer_email) = LOWER($2)
                       AND service_id = ANY($3)
                       AND (service_variant_id IS NULL OR service_variant_id = ANY($4))
                       AND (expires_at IS NULL OR expires_at > NOW())
                     ORDER BY service_variant_id DESC NULLS LAST, sessions_remaining ASC LIMIT 1`,
                    [businessId, client_email, serviceIds, variantIds.filter(Boolean)]
                  );
                }
                if (passRes && passRes.rows.length > 0) {
                  const pass = passRes.rows[0];
                  // Find the specific booking that matches this pass's service
                  const matchIdx = bookings.findIndex((bk, i) =>
                    String(chainedSlots[i].service_id) === String(pass.service_id) &&
                    (!pass.service_variant_id || String(chainedSlots[i].service_variant_id) === String(pass.service_variant_id))
                  );
                  if (matchIdx >= 0) {
                    const newRemaining = pass.sessions_remaining - 1;
                    await client.query(
                      `UPDATE passes SET sessions_remaining = $1, status = $2, updated_at = NOW() WHERE id = $3`,
                      [newRemaining, newRemaining === 0 ? 'used' : 'active', pass.id]
                    );
                    passMatchedBookingId = bookings[matchIdx].id;
                    await client.query(
                      `INSERT INTO pass_transactions (id, pass_id, business_id, booking_id, sessions, type, note)
                       VALUES (gen_random_uuid(), $1, $2, $3, 1, 'debit', $4)`,
                      [pass.id, businessId, passMatchedBookingId, `Séance — pass ${pass.code}`]
                    );
                    passUsed = pass.code;
                    console.log(`[PASS] Multi auto-debit pass ${pass.code} for booking ${passMatchedBookingId} (1 session), remaining: ${newRemaining}`);
                  }
                }
              } catch (passErr) {
                console.error('[PASS] Multi auto-debit failed:', passErr.message);
              }
            }

            if (depResult.required) {
              const hoursUntilRdv = (startDate.getTime() - Date.now()) / 3600000;
              // Skip deposit only if RDV is less than 3h away (not enough time to pay)
              if (hoursUntilRdv >= 3) {
                let gcAutoPaid = false;
                // If pass was used, mark only the matched booking as pass-paid
                // Other bookings still need normal deposit flow
                if (passUsed && passMatchedBookingId) {
                  await client.query(
                    `UPDATE bookings SET status = 'confirmed', deposit_required = true, deposit_amount_cents = $1,
                      deposit_status = 'paid', deposit_paid_at = NOW(),
                      deposit_payment_intent_id = $2
                     WHERE id = $3 AND business_id = $4`,
                    [depResult.depCents, `pass_${passUsed}`, passMatchedBookingId, businessId]
                  );
                  // Only mark fully covered if there's just 1 booking, or all bookings are pass-matched
                  if (bookings.length === 1 || bookings.every(bk => bk.id === passMatchedBookingId)) {
                    bookings[0].deposit_required = true;
                    bookings[0].deposit_amount_cents = depResult.depCents;
                    bookings[0].deposit_status = 'paid';
                    bookings[0].deposit_payment_intent_id = `pass_${passUsed}`;
                    gcAutoPaid = true;
                  }
                  console.log(`[DEPOSIT] Pass ${passUsed} covers deposit for booking ${passMatchedBookingId} only`);
                }

                // Determine which bookings still need deposit (exclude pass-covered)
                const unpaidBookings = bookings.filter(bk => bk.id !== passMatchedBookingId);
                const firstUnpaid = unpaidBookings[0] || bookings[0];

                // Check for gift card auto-debit (only for unpaid bookings)
                if (!gcAutoPaid && unpaidBookings.length > 0 && (gift_card_code || client_email)) {
                  try {
                    let gcRes;
                    if (gift_card_code) {
                      gcRes = await client.query(
                        `SELECT id, code, balance_cents FROM gift_cards
                         WHERE business_id = $1 AND code = $2 AND status = 'active' AND balance_cents > 0
                           AND (expires_at IS NULL OR expires_at > NOW())
                         LIMIT 1`,
                        [businessId, gift_card_code.toUpperCase().trim()]
                      );
                    } else {
                      gcRes = await client.query(
                        `SELECT id, code, balance_cents FROM gift_cards
                         WHERE business_id = $1 AND status = 'active' AND balance_cents > 0
                           AND (LOWER(recipient_email) = LOWER($2) OR LOWER(buyer_email) = LOWER($2))
                           AND (expires_at IS NULL OR expires_at > NOW())
                         ORDER BY balance_cents DESC LIMIT 1`,
                        [businessId, client_email]
                      );
                    }
                    if (gcRes.rows.length > 0) {
                      const gc = gcRes.rows[0];
                      const gcDebit = Math.min(gc.balance_cents, depResult.depCents);
                      const newBal = gc.balance_cents - gcDebit;
                      await client.query(
                        `UPDATE gift_cards SET balance_cents = $1, status = $2, updated_at = NOW() WHERE id = $3`,
                        [newBal, newBal === 0 ? 'used' : 'active', gc.id]
                      );
                      await client.query(
                        `INSERT INTO gift_card_transactions (id, gift_card_id, business_id, booking_id, amount_cents, type, note)
                         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'debit', $5)`,
                        [gc.id, businessId, firstUnpaid.id, gcDebit, `Acompte auto — carte ${gc.code}`]
                      );

                      if (gcDebit >= depResult.depCents) {
                        // Fully covered by GC — mark only unpaid bookings
                        const unpaidIds = unpaidBookings.map(b => b.id);
                        await client.query(
                          `UPDATE bookings SET deposit_required = true, deposit_amount_cents = $1,
                            deposit_status = 'paid', deposit_paid_at = NOW(),
                            deposit_payment_intent_id = $2
                           WHERE id = ANY($3) AND business_id = $4`,
                          [depResult.depCents, `gc_${gc.code}`, unpaidIds, businessId]
                        );
                        for (const bk of unpaidBookings) {
                          bk.deposit_required = true;
                          bk.deposit_amount_cents = depResult.depCents;
                          bk.deposit_status = 'paid';
                          bk.deposit_payment_intent_id = `gc_${gc.code}`;
                        }
                        gcAutoPaid = true;
                        console.log(`[DEPOSIT] Multi GC ${gc.code} covers ${unpaidIds.length} unpaid bookings (${gcDebit}c), balance: ${newBal}c`);
                      } else {
                        gcPartialCents = gcDebit;
                        console.log(`[DEPOSIT] Multi partial GC ${gc.code}: ${gcDebit}c of ${depResult.depCents}c, remaining via Stripe, balance: ${newBal}c`);
                      }
                    }
                  } catch (gcErr) {
                    console.error('[DEPOSIT] Multi gift card auto-debit failed:', gcErr.message);
                  }
                }

                if (!gcAutoPaid && unpaidBookings.length > 0) {
                  const deadline = computeDepositDeadline(startDate, bizSettings);
                  // Set pending_deposit on unpaid bookings only
                  await client.query(
                    `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
                      deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2,
                      deposit_requested_at = NOW(), deposit_request_count = 1,
                      confirmation_expires_at = NULL
                     WHERE id = $3 AND business_id = $4`,
                    [depResult.depCents, deadline.toISOString(), firstUnpaid.id, businessId]
                  );
                  firstUnpaid.status = 'pending_deposit';
                  firstUnpaid.deposit_required = true;
                  firstUnpaid.deposit_amount_cents = depResult.depCents;
                  firstUnpaid.deposit_deadline = deadline.toISOString();
                  const remainingUnpaidIds = unpaidBookings.slice(1).map(b => b.id);
                  if (remainingUnpaidIds.length > 0) {
                    await client.query(
                      `UPDATE bookings SET status = 'pending_deposit', deposit_required = true, deposit_status = 'pending',
                        deposit_amount_cents = $3, deposit_deadline = $4
                       WHERE id = ANY($1) AND business_id = $2`,
                      [remainingUnpaidIds, businessId, depResult.depCents, deadline.toISOString()]
                    );
                  }
                  for (const bk of unpaidBookings) bk.status = 'pending_deposit';
                  // Update bookings[0] reference for email/response
                  bookings[0].deposit_required = true;
                  bookings[0].deposit_amount_cents = depResult.depCents;
                  bookings[0].deposit_deadline = deadline.toISOString();
                  if (unpaidBookings.includes(bookings[0])) bookings[0].status = 'pending_deposit';
                  console.log(`[DEPOSIT] Multi-service deposit triggered (${depResult.reason}): ${depResult.depCents} cents, deadline: ${deadline.toISOString()}`);
                }
              }
            }
          } catch (depErr) {
            await client.query('ROLLBACK TO SAVEPOINT deposit_sp');
            console.error('Deposit check failed:', depErr.message);
            // If deposit is enabled, abort the booking — don't let it slip through without deposit
            if (bizSettings.deposit_enabled) {
              throw new Error('Impossible de vérifier l\'acompte. Veuillez réessayer.');
            }
          }
        }

        // Queue notifications for first booking (skip email_confirmation if deposit active)
        if (bookings[0].status !== 'pending_deposit') {
          try {
            await client.query('SAVEPOINT notif_multi_sp1');
            await client.query(
              `INSERT INTO notifications (business_id, booking_id, type, recipient_email, recipient_phone, status)
               VALUES ($1,$2,'email_confirmation',$3,$4,'queued')`,
              [businessId, bookings[0].id, client_email, client_phone]
            );
          } catch (notifErr) {
            await client.query('ROLLBACK TO SAVEPOINT notif_multi_sp1');
            console.error('Notification insert failed:', notifErr.message);
          }
        }
        try {
          await client.query('SAVEPOINT notif_multi_sp2');
          await client.query(
            `INSERT INTO notifications (business_id, booking_id, type, status)
             VALUES ($1,$2,'email_new_booking_pro','queued')`,
            [businessId, bookings[0].id]
          );
        } catch (notifErr) {
          await client.query('ROLLBACK TO SAVEPOINT notif_multi_sp2');
          console.error('Notification insert failed:', notifErr.message);
        }

        return { bookings, needsConfirmation, confirmTimeoutMin, confirmChannel, gcPartialCents };
      });

      const { bookings: multiBookings, needsConfirmation: multiNeedsConfirm, confirmTimeoutMin: multiConfTimeout, confirmChannel: multiConfChannel, gcPartialCents: multiGcPartial } = multiResult;

      broadcast(businessId, 'booking_update', { action: 'created', source: 'public' });
      // H1: calSyncPush for each created booking
      for (const mb of multiBookings) {
        try { const { calSyncPush } = require('../staff/bookings-helpers'); calSyncPush(businessId, mb.id); } catch (_) {}
      }

      // Send email (non-blocking): deposit request, confirmation request, OR direct confirmation
      (async () => {
        try {
          const bizRow = await query(`SELECT name, email, address, theme, settings, plan FROM businesses WHERE id = $1`, [businessId]);
          // Fetch practitioner names — split mode may have multiple practitioners
          let pracDisplayName = '';
          const splitPracNames = {}; // practitioner_id → display_name
          if (isSplitMode) {
            const uniquePIds = [...new Set(Object.values(splitPracMap))];
            const pracRows = await query(`SELECT id, display_name FROM practitioners WHERE id = ANY($1)`, [uniquePIds]);
            pracRows.rows.forEach(r => { splitPracNames[r.id] = r.display_name; });
            pracDisplayName = pracRows.rows.map(r => r.display_name).filter(Boolean).join(', ');
          } else {
            const pracRow = await query(`SELECT display_name FROM practitioners WHERE id = $1`, [practitioner_id]);
            pracDisplayName = pracRow.rows[0]?.display_name || '';
          }
          if (bizRow.rows[0]) {
            const lastBooking = multiBookings[multiBookings.length - 1];
            // Find which booking carries the promo (may not be group_order=0 for specific_service promos)
            const emailPromoBooking = multiBookings.find(b => b.promotion_discount_cents > 0) || multiBookings[0];
            const emailBooking = {
              ...multiBookings[0],
              end_at: lastBooking.end_at,
              client_name, client_email,
              service_price_cents: multiServices[0]?.price_cents || 0,
              duration_min: multiServices[0]?.duration_min || 0,
              service_category: multiServices[0]?.category || null,
              practitioner_name: pracDisplayName,
              comment: client_comment,
              gc_partial_cents: multiGcPartial || 0,
              promotion_id: emailPromoBooking.promotion_id,
              promotion_label: emailPromoBooking.promotion_label,
              promotion_discount_pct: emailPromoBooking.promotion_discount_pct,
              promotion_discount_cents: emailPromoBooking.promotion_discount_cents || 0
            };
            const groupSvcs = multiServices.map(s => ({
              name: s._variant_name ? s.name + ' \u2014 ' + s._variant_name : s.name,
              duration_min: s.duration_min,
              price_cents: s.price_cents,
              practitioner_name: isSplitMode ? (splitPracNames[splitPracMap[s.id]] || null) : null
            }));

            if (multiBookings[0].status === 'pending_deposit') {
              // Deposit auto-triggered: send deposit request email (payment serves as confirmation)
              const baseUrl = BASE_URL;
              const depositUrl = `${baseUrl}/deposit/${multiBookings[0].public_token}`;
              await query(`UPDATE bookings SET deposit_payment_url = $1 WHERE id = $2`, [depositUrl, multiBookings[0].id]);
              const { sendDepositRequestEmail } = require('../../services/email');
              const payUrl = `${baseUrl}/api/public/deposit/${multiBookings[0].public_token}/pay`;
              await sendDepositRequestEmail({
                booking: emailBooking,
                business: bizRow.rows[0],
                depositUrl,
                payUrl,
                groupServices: groupSvcs
              });
              // Audit trail
              try {
                await query(
                  `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status, sent_at)
                   VALUES ($1,$2,'email_deposit_request',$3,'sent',NOW())`,
                  [businessId, multiBookings[0].id, client_email]
                );
              } catch (_) { /* best-effort audit */ }
              // SMS with deposit payment link
              if (client_phone && ['pro', 'premium'].includes(bizRow.rows[0].plan)) {
                try {
                  const { sendSMS } = require('../../services/sms');
                  const _sd = new Date(emailBooking.start_at);
                  const _sDate = _sd.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
                  const _sTime = _sd.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
                  const depAmt = (multiBookings[0].deposit_amount_cents / 100).toFixed(2).replace('.', ',');
                  await sendSMS({ to: client_phone, body: `${bizRow.rows[0].name} : RDV le ${_sDate} à ${_sTime}. Acompte de ${depAmt}€ requis. Payez ici : ${depositUrl}`, businessId });
                  try {
                    await query(
                      `INSERT INTO notifications (business_id, booking_id, type, recipient_phone, status, sent_at)
                       VALUES ($1,$2,'sms_deposit_request',$3,'sent',NOW())`,
                      [businessId, multiBookings[0].id, client_phone]
                    );
                  } catch (_) {}
                } catch (smsErr) { console.warn('[SMS] Deposit request SMS error:', smsErr.message); }
              }
            } else if (multiNeedsConfirm) {
              // Send confirmation REQUEST (client must click to confirm)
              const { sendBookingConfirmationRequest } = require('../../services/email');
              if (multiConfChannel === 'email' || multiConfChannel === 'both') {
                await sendBookingConfirmationRequest({ booking: emailBooking, business: bizRow.rows[0], timeoutMin: multiConfTimeout, groupServices: groupSvcs });
              }
              if (multiConfChannel === 'sms' || multiConfChannel === 'both') {
                try {
                  const { sendSMS } = require('../../services/sms');
                  const baseUrl = BASE_URL;
                  const link = `${baseUrl}/api/public/booking/${multiBookings[0].public_token}/confirm-booking`;
                  const _sd = new Date(emailBooking.start_at);
                  const _sDate = _sd.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
                  const _sTime = _sd.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
                  await sendSMS({ to: client_phone, body: `${bizRow.rows[0].name} : RDV le ${_sDate} à ${_sTime}. Répondez OUI pour confirmer ou cliquez ici : ${link}`, businessId });
                } catch (smsErr) { console.warn('[SMS] Booking confirm SMS error:', smsErr.message); }
              }
            } else {
              await sendBookingConfirmation({ booking: emailBooking, business: bizRow.rows[0], groupServices: groupSvcs });
            }
          }
        } catch (e) { console.warn('[EMAIL] Multi-service confirmation error:', e.message); }
      })();

      // Find the booking that carries the promo (could be on any group_order for specific_service promos)
      const promoBooking = multiBookings.find(b => b.promotion_discount_cents > 0) || multiBookings[0];

      // BUG-C4: Compute total_after_discount from individual service prices + per-service LM discounts
      let totalOriginalCents = 0;
      let totalAfterLmCents = 0;
      for (let i = 0; i < multiServices.length; i++) {
        const svcPrice = multiServices[i].price_cents || 0;
        totalOriginalCents += svcPrice;
        const bk = multiBookings[i];
        if (bk && bk.discount_pct) {
          totalAfterLmCents += Math.round(svcPrice * (100 - bk.discount_pct) / 100);
        } else {
          totalAfterLmCents += svcPrice;
        }
      }
      // Apply promo discount on top of LM-discounted total
      const promoDiscCents = promoBooking.promotion_discount_cents || 0;
      const totalAfterAllDiscounts = totalAfterLmCents - promoDiscCents;

      return res.status(201).json({
        booking: {
          id: multiBookings[0].id, token: multiBookings[0].public_token,
          start_at: multiBookings[0].start_at, end_at: multiBookings[0].end_at, status: multiBookings[0].status,
          cancel_url: `${BASE_URL}/booking/${multiBookings[0].public_token}`,
          discount_pct: multiBookings[0].discount_pct,
          deposit_amount_cents: multiBookings[0].deposit_amount_cents || null,
          total_original_cents: totalOriginalCents,
          total_after_discount_cents: totalAfterAllDiscounts
        },
        bookings: multiBookings.map(b => ({
          id: b.id, token: b.public_token,
          start_at: b.start_at, end_at: b.end_at, status: b.status,
          group_order: b.group_order,
          discount_pct: b.discount_pct || null,
          promotion_id: b.promotion_id, promotion_label: b.promotion_label,
          promotion_discount_pct: b.promotion_discount_pct, promotion_discount_cents: b.promotion_discount_cents
        })),
        promotion: promoBooking.promotion_id ? {
          label: promoBooking.promotion_label,
          discount_pct: promoBooking.promotion_discount_pct,
          discount_cents: promoBooking.promotion_discount_cents
        } : null,
        group_id: groupId,
        needs_confirmation: multiNeedsConfirm && multiBookings[0].status !== 'pending_deposit'
      });
    }

    // ══════════════════════════════════════════════════════════
    // SINGLE-SERVICE BOOKING FLOW (existing behavior unchanged)
    // ══════════════════════════════════════════════════════════
    let endDate;

    // Resolve single-service variant
    let resolvedVariantId = null;
    if (variant_id && UUID_RE.test(variant_id)) {
      resolvedVariantId = variant_id;
    }

    let resolvedProcessingTime = 0;
    let resolvedProcessingStart = 0;
    let resolvedFlexEnabled = false;

    if (effectiveServiceId) {
      const svcResult = await query(
        `SELECT duration_min, buffer_before_min, buffer_after_min, processing_time, processing_start, flexibility_enabled, mode_options
         FROM services WHERE id = $1 AND business_id = $2 AND is_active = true AND bookable_online = true`,
        [effectiveServiceId, businessId]
      );
      if (svcResult.rows.length === 0) return res.status(404).json({ error: 'Prestation introuvable ou non disponible en ligne' });
      // M7: Validate appointment mode against service's allowed modes
      if (appointment_mode && svcResult.rows[0].mode_options && Array.isArray(svcResult.rows[0].mode_options) && svcResult.rows[0].mode_options.length > 0) {
        if (!svcResult.rows[0].mode_options.includes(appointment_mode)) {
          return res.status(400).json({ error: `Mode "${appointment_mode}" non disponible pour cette prestation` });
        }
      }
      const service = svcResult.rows[0];

      // Override duration from variant if provided
      resolvedProcessingTime = service.processing_time || 0;
      resolvedProcessingStart = service.processing_start || 0;
      resolvedFlexEnabled = !!service.flexibility_enabled;
      if (resolvedVariantId) {
        const vr = await queryWithRLS(businessId,
          `SELECT duration_min, processing_time, processing_start FROM service_variants
           WHERE id = $1 AND service_id = $2 AND business_id = $3 AND is_active = true`,
          [resolvedVariantId, effectiveServiceId, businessId]
        );
        if (vr.rows.length === 0) return res.status(404).json({ error: 'Variante introuvable' });
        service.duration_min = vr.rows[0].duration_min;
        resolvedProcessingTime = vr.rows[0].processing_time || 0;
        resolvedProcessingStart = vr.rows[0].processing_start || 0;
      }

      // PUB-V12-005: Buffer times are intentionally included in end_at for calendar blocking purposes
      const totalDuration = (service.buffer_before_min || 0) + service.duration_min + (service.buffer_after_min || 0);
      endDate = new Date(startDate.getTime() + totalDuration * 60000);
    } else {
      // Featured slot booking — use end_at or default 15 min
      endDate = end_at ? new Date(end_at) : new Date(startDate.getTime() + 15 * 60000);
      if (isNaN(endDate.getTime())) return res.status(400).json({ error: 'Date de fin invalide' });
      if (endDate.getTime() <= startDate.getTime()) return res.status(400).json({ error: 'La date de fin doit être après la date de début' });
      // Bug M10 fix: cap arbitrary-duration bookings at 4 hours
      const maxDuration = 4 * 60 * 60000; // 4 hours
      if (endDate.getTime() - startDate.getTime() > maxDuration) {
        return res.status(400).json({ error: 'Durée maximale dépassée (4h)' });
      }
    }

    // Validate practitioner is active + booking_enabled + capacity
    const pracCap = await query(
      `SELECT COALESCE(max_concurrent, 1) AS max_concurrent, is_active, booking_enabled
       FROM practitioners WHERE id = $1 AND business_id = $2`,
      [practitioner_id, businessId]
    );
    if (pracCap.rows.length === 0 || !pracCap.rows[0].is_active || !pracCap.rows[0].booking_enabled) {
      return res.status(400).json({ error: 'Ce praticien n\'est pas disponible pour la prise de rendez-vous' });
    }
    const maxConcurrent = pracCap.rows[0]?.max_concurrent ?? 1;

    // Validate practitioner offers this service
    if (effectiveServiceId) {
      const psCheck = await query(
        `SELECT 1 FROM practitioner_services WHERE service_id = $1 AND practitioner_id = $2`,
        [effectiveServiceId, practitioner_id]
      );
      if (psCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Ce praticien ne propose pas cette prestation' });
      }
    }

    // Validate booking fits within practitioner's availability window
    const availCheck = await checkPracAvailability(businessId, practitioner_id, startDate, endDate);
    if (!availCheck.ok) {
      return res.status(400).json({ error: availCheck.reason });
    }

    const result = await transactionWithRLS(businessId, async (client) => {
      // Booking confirmation setting
      const _bizConf = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [businessId]);
      const _bizSettings = _bizConf.rows[0]?.settings || {};
      const needsConfirmation = !!_bizSettings.booking_confirmation_required;
      const bookingStatus = needsConfirmation ? 'pending' : 'confirmed';
      const confirmTimeoutMin = parseInt(_bizSettings.booking_confirmation_timeout_min) || 30;
      const confirmChannel = _bizSettings.booking_confirmation_channel || 'email';

      // Conflict check (capacity-aware, pose-aware)
      const conflicts = await checkBookingConflicts(client, { bid: businessId, pracId: practitioner_id, newStart: startDate.toISOString(), newEnd: endDate.toISOString() });
      if (conflicts.length >= maxConcurrent) {
        throw Object.assign(new Error('Ce créneau vient d\'être pris.'), { type: 'conflict' });
      }

      // Find or create client (4-step matching: OAuth > exact > phone > email)
      let clientId;
      let existingClient = null;
      let matchType = null;

      // Priority 1: OAuth provider match (most reliable identity)
      if (oauth_provider && oauth_provider_id) {
        const oauthMatch = await client.query(
          `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND oauth_provider = $2 AND oauth_provider_id = $3 LIMIT 1`,
          [businessId, oauth_provider, oauth_provider_id]
        );
        if (oauthMatch.rows.length > 0) {
          existingClient = oauthMatch.rows[0];
          matchType = 'oauth';
        }
      }

      if (!existingClient) {
        const exactMatch = await client.query(
          `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND phone = $2 AND LOWER(email) = LOWER($3) LIMIT 1`,
          [businessId, client_phone, client_email]
        );
        if (exactMatch.rows.length > 0) {
          existingClient = exactMatch.rows[0];
          matchType = 'exact';
        } else {
          const phoneMatch = await client.query(
            `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND phone = $2 LIMIT 1`,
            [businessId, client_phone]
          );
          if (phoneMatch.rows.length > 0) {
            existingClient = phoneMatch.rows[0];
            matchType = 'phone';
          } else {
            const emailMatch = await client.query(
              `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
              [businessId, client_email]
            );
            if (emailMatch.rows.length > 0) {
              existingClient = emailMatch.rows[0];
              matchType = 'email';
            }
          }
        }
      }

      if (existingClient) {
        if (existingClient.is_blocked) {
          throw Object.assign(
            new Error('Votre compte est temporairement suspendu. Veuillez contacter le cabinet directement.'),
            { type: 'blocked', status: 403 }
          );
        }
        clientId = existingClient.id;
        if (matchType === 'oauth' || matchType === 'exact') {
          // Only fill empty fields — merchant edits in dashboard take priority
          await client.query(
            `UPDATE clients SET
              full_name = COALESCE(full_name, NULLIF($1, '')),
              email = COALESCE(email, NULLIF($2, '')),
              phone = COALESCE(phone, NULLIF($3, '')),
              bce_number = COALESCE($4, bce_number),
              consent_sms = COALESCE($5, consent_sms),
              consent_email = COALESCE($6, consent_email),
              consent_marketing = COALESCE($7, consent_marketing),
              oauth_provider = COALESCE($9, oauth_provider),
              oauth_provider_id = COALESCE($10, oauth_provider_id),
              updated_at = NOW()
             WHERE id = $8`,
            [client_name, client_email, client_phone, client_bce,
             consent_sms === true ? true : (consent_sms === false ? false : null),
             consent_email === true ? true : (consent_email === false ? false : null),
             consent_marketing === true ? true : (consent_marketing === false ? false : null),
             clientId,
             oauth_provider || null, oauth_provider_id || null]
          );
        } else if (matchType === 'phone' || matchType === 'email') {
          // Soft merge: only fill empty fields — merchant edits take priority
          await client.query(
            `UPDATE clients SET
              full_name = COALESCE(full_name, NULLIF($2, '')),
              phone = COALESCE(phone, NULLIF($4, '')),
              email = COALESCE(email, NULLIF($5, '')),
              oauth_provider = COALESCE($6, oauth_provider),
              oauth_provider_id = COALESCE($7, oauth_provider_id),
              updated_at = NOW()
             WHERE id = $1 AND business_id = $3`,
            [clientId, client_name, businessId, client_phone, client_email, oauth_provider || null, oauth_provider_id || null]
          );
        }
      } else {
        const nc = await client.query(
          `INSERT INTO clients (business_id, full_name, phone, email, bce_number,
            language_preference, consent_sms, consent_email, consent_marketing, created_from,
            oauth_provider, oauth_provider_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'booking',$10,$11) RETURNING id`,
          [businessId, client_name, client_phone, client_email, client_bce||null,
           safeLang, consent_sms===true, consent_email===true, consent_marketing===true,
           oauth_provider || null, oauth_provider_id || null]
        );
        clientId = nc.rows[0].id;
      }

      // Determine locked status based on service flexibility setting
      const singleLocked = resolvedFlexEnabled ? (flexible !== true) : false;

      // Resolve last-minute discount (validate server-side to prevent abuse)
      let resolvedDiscountPct = null;
      if (is_last_minute && bizSettings.last_minute_enabled) {
        const lmDeadline = bizSettings.last_minute_deadline || 'j-1';
        const startBrussels = startDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        const todayBrussels = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
        if (isWithinLastMinuteWindow(startBrussels, todayBrussels, lmDeadline)) {
          const lmMinPrice = bizSettings.last_minute_min_price_cents || 0;
          // Resolve effective price (variant or service)
          let effPrice = 0;
          const _sp = await client.query(`SELECT price_cents, promo_eligible FROM services WHERE id = $1`, [effectiveServiceId]);
          if (_sp.rows[0]?.promo_eligible === false) { /* Service not eligible */ }
          else {
          effPrice = _sp.rows[0]?.price_cents || 0;
          if (resolvedVariantId) {
            const _vp = await client.query(`SELECT price_cents FROM service_variants WHERE id = $1`, [resolvedVariantId]);
            if (_vp.rows[0]?.price_cents != null) effPrice = _vp.rows[0].price_cents;
          }
          if (effPrice > 0 && effPrice >= lmMinPrice) {
            resolvedDiscountPct = bizSettings.last_minute_discount_pct || 10;
          }
          } // end promo_eligible check
        }
      }

      // ── Promo validation (single-service) ──
      const isNewClient = !existingClient;
      let promoResult = { valid: false };
      if (promotion_id && UUID_RE.test(promotion_id)) {
        let promoSvcPrice = 0;
        const _promoSvcRes = await client.query(`SELECT price_cents FROM services WHERE id = $1`, [effectiveServiceId]);
        promoSvcPrice = _promoSvcRes.rows[0]?.price_cents || 0;
        if (resolvedVariantId) {
          const _promoVarRes = await client.query(`SELECT price_cents FROM service_variants WHERE id = $1`, [resolvedVariantId]);
          if (_promoVarRes.rows[0]?.price_cents != null) promoSvcPrice = _promoVarRes.rows[0].price_cents;
        }
        const servicePrices = { [effectiveServiceId]: promoSvcPrice };
        promoResult = await validateAndCalcPromo(client, businessId, promotion_id, [effectiveServiceId], promoSvcPrice, isNewClient, clientId, servicePrices);
      }

      // Create booking
      const booking = await client.query(
        `INSERT INTO bookings (business_id, practitioner_id, service_id, service_variant_id, client_id,
          channel, appointment_mode, start_at, end_at, status, comment_client, confirmation_expires_at,
          processing_time, processing_start, locked, discount_pct,
          promotion_id, promotion_label, promotion_discount_pct, promotion_discount_cents)
         VALUES ($1,$2,$3,$4,$5,'web',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING id, public_token, start_at, end_at, status, discount_pct,
                   promotion_id, promotion_label, promotion_discount_pct, promotion_discount_cents`,
        [businessId, practitioner_id, effectiveServiceId, resolvedVariantId, clientId,
         appointment_mode||'cabinet', startDate.toISOString(), endDate.toISOString(), bookingStatus, client_comment||null,
         needsConfirmation ? new Date(Date.now() + confirmTimeoutMin * 60000).toISOString() : null,
         resolvedProcessingTime, resolvedProcessingStart, bookingStatus === 'confirmed' ? true : singleLocked, resolvedDiscountPct,
         promoResult.valid ? promotion_id : null,
         promoResult.valid ? promoResult.label : null,
         promoResult.valid ? promoResult.discount_pct : null,
         promoResult.valid ? promoResult.discount_cents : 0]
      );

      // ── Deposit check (single-service) — triggers: price/duration thresholds OR no-show recidivist ──
      let gcPartialCents = 0;
      let bizSettings = {};
      if (booking.rows[0]) {
        try {
          await client.query('SAVEPOINT deposit_single_sp');

          // Get business settings
          const bizSettingsRow = await client.query(`SELECT settings FROM businesses WHERE id = $1`, [businessId]);
          bizSettings = bizSettingsRow.rows[0]?.settings || {};

          // Get service price + duration (use variant if applicable)
          let svcPrice = 0, svcDuration = 0;
          const svcInfoResult = await client.query(
            `SELECT COALESCE(s.price_cents, 0) AS price, COALESCE(s.duration_min, 0) AS duration
             FROM bookings b JOIN services s ON s.id = b.service_id
             WHERE b.id = $1 AND b.business_id = $2`,
            [booking.rows[0].id, businessId]
          );
          svcPrice = parseInt(svcInfoResult.rows[0]?.price) || 0;
          svcDuration = parseInt(svcInfoResult.rows[0]?.duration) || 0;
          if (resolvedVariantId) {
            const varInfo = await client.query(`SELECT price_cents, duration_min FROM service_variants WHERE id = $1`, [resolvedVariantId]);
            if (varInfo.rows[0]?.price_cents != null) svcPrice = varInfo.rows[0].price_cents;
            if (varInfo.rows[0]?.duration_min != null) svcDuration = varInfo.rows[0].duration_min;
          }

          // Get no-show count + VIP status (0/false for new clients)
          let noShowCount = 0;
          let clientIsVip = false;
          if (clientId) {
            const nsRow = await client.query(`SELECT no_show_count, is_vip FROM clients WHERE id = $1`, [clientId]);
            noShowCount = nsRow.rows[0]?.no_show_count || 0;
            clientIsVip = !!nsRow.rows[0]?.is_vip;
          }

          const depResult = shouldRequireDeposit(bizSettings, svcPrice, svcDuration, noShowCount, clientIsVip);

          // Recalculate deposit amount on reduced price if promo applied
          const promoDiscountCents = promoResult.valid ? promoResult.discount_cents : 0;
          if (depResult.required && promoDiscountCents > 0) {
            const reducedSvcPrice = Math.max(0, svcPrice - promoDiscountCents);
            if (bizSettings.deposit_type === 'fixed') {
              // Cap fixed deposit at reduced price
              if (depResult.depCents > reducedSvcPrice) depResult.depCents = reducedSvcPrice;
            } else {
              depResult.depCents = Math.round(reducedSvcPrice * (bizSettings.deposit_percent || 50) / 100);
            }
            if (depResult.depCents <= 0) depResult.required = false;
          }

          // Pass auto-debit — runs even without deposit (pass = proof of attendance)
          let passUsed = false;
          if (pass_code || client_email) {
            try {
              const effectiveVariantId = booking.rows[0].service_variant_id || null;
              let passRes;
              if (pass_code) {
                passRes = await client.query(
                  `SELECT id, code, sessions_remaining, service_id, service_variant_id FROM passes
                   WHERE business_id = $1 AND code = $2 AND status = 'active' AND sessions_remaining > 0
                     AND (expires_at IS NULL OR expires_at > NOW())
                   LIMIT 1`,
                  [businessId, pass_code.toUpperCase().trim()]
                );
              } else if (client_email) {
                passRes = await client.query(
                  `SELECT id, code, sessions_remaining, service_id, service_variant_id FROM passes
                   WHERE business_id = $1 AND status = 'active' AND sessions_remaining > 0
                     AND LOWER(buyer_email) = LOWER($2)
                     AND service_id = $3
                     AND (service_variant_id IS NULL OR service_variant_id = $4)
                     AND (expires_at IS NULL OR expires_at > NOW())
                   ORDER BY service_variant_id DESC NULLS LAST, sessions_remaining ASC LIMIT 1`,
                  [businessId, client_email, effectiveServiceId, effectiveVariantId]
                );
              }
              if (passRes && passRes.rows.length > 0) {
                const pass = passRes.rows[0];
                const serviceMatch = pass.service_id === effectiveServiceId;
                const variantMatch = !pass.service_variant_id || pass.service_variant_id === effectiveVariantId;
                if (serviceMatch && variantMatch) {
                  const newRemaining = pass.sessions_remaining - 1;
                  await client.query(
                    `UPDATE passes SET sessions_remaining = $1, status = $2, updated_at = NOW() WHERE id = $3`,
                    [newRemaining, newRemaining === 0 ? 'used' : 'active', pass.id]
                  );
                  await client.query(
                    `INSERT INTO pass_transactions (id, pass_id, business_id, booking_id, sessions, type, note)
                     VALUES (gen_random_uuid(), $1, $2, $3, 1, 'debit', $4)`,
                    [pass.id, businessId, booking.rows[0].id, `Séance — pass ${pass.code}`]
                  );
                  passUsed = pass.code;
                  console.log(`[PASS] Auto-debit pass ${pass.code} (1 session), remaining: ${newRemaining}`);
                }
              }
            } catch (passErr) {
              console.error('[PASS] Auto-debit failed:', passErr.message);
            }
          }

          if (depResult.required) {
            const hoursUntilRdv = (startDate.getTime() - Date.now()) / 3600000;
            // Skip deposit only if RDV is less than 2h away (not enough time to pay)
            if (hoursUntilRdv >= 2) {
              // If pass was used, it covers the deposit
              let gcAutoPaid = false;
              if (passUsed) {
                await client.query(
                  `UPDATE bookings SET deposit_required = true, deposit_amount_cents = $1,
                    deposit_status = 'paid', deposit_paid_at = NOW(),
                    deposit_payment_intent_id = $2
                   WHERE id = $3 AND business_id = $4`,
                  [depResult.depCents, `pass_${passUsed}`, booking.rows[0].id, businessId]
                );
                booking.rows[0].deposit_required = true;
                booking.rows[0].deposit_amount_cents = depResult.depCents;
                booking.rows[0].deposit_status = 'paid';
                booking.rows[0].deposit_payment_intent_id = `pass_${passUsed}`;
                gcAutoPaid = true;
                console.log(`[DEPOSIT] Fully covered by pass ${passUsed}`);
              }

              // Check for gift card auto-debit (if pass didn't cover it)
              if (!gcAutoPaid && (gift_card_code || client_email)) {
                try {
                  let gcRes;
                  if (gift_card_code) {
                    gcRes = await client.query(
                      `SELECT id, code, balance_cents FROM gift_cards
                       WHERE business_id = $1 AND code = $2 AND status = 'active' AND balance_cents > 0
                         AND (expires_at IS NULL OR expires_at > NOW())
                       LIMIT 1`,
                      [businessId, gift_card_code.toUpperCase().trim()]
                    );
                  } else {
                    gcRes = await client.query(
                      `SELECT id, code, balance_cents FROM gift_cards
                       WHERE business_id = $1 AND status = 'active' AND balance_cents > 0
                         AND (LOWER(recipient_email) = LOWER($2) OR LOWER(buyer_email) = LOWER($2))
                         AND (expires_at IS NULL OR expires_at > NOW())
                       ORDER BY balance_cents DESC LIMIT 1`,
                      [businessId, client_email]
                    );
                  }
                  if (gcRes.rows.length > 0) {
                    const gc = gcRes.rows[0];
                    const gcDebit = Math.min(gc.balance_cents, depResult.depCents);
                    const newBal = gc.balance_cents - gcDebit;
                    await client.query(
                      `UPDATE gift_cards SET balance_cents = $1, status = $2, updated_at = NOW() WHERE id = $3`,
                      [newBal, newBal === 0 ? 'used' : 'active', gc.id]
                    );
                    await client.query(
                      `INSERT INTO gift_card_transactions (id, gift_card_id, business_id, booking_id, amount_cents, type, note)
                       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'debit', $5)`,
                      [gc.id, businessId, booking.rows[0].id, gcDebit, `Acompte auto — carte ${gc.code}`]
                    );

                    if (gcDebit >= depResult.depCents) {
                      // Fully covered by GC
                      await client.query(
                        `UPDATE bookings SET deposit_required = true, deposit_amount_cents = $1,
                          deposit_status = 'paid', deposit_paid_at = NOW(),
                          deposit_payment_intent_id = $2
                         WHERE id = $3 AND business_id = $4`,
                        [depResult.depCents, `gc_${gc.code}`, booking.rows[0].id, businessId]
                      );
                      booking.rows[0].deposit_required = true;
                      booking.rows[0].deposit_amount_cents = depResult.depCents;
                      booking.rows[0].deposit_status = 'paid';
                      booking.rows[0].deposit_payment_intent_id = `gc_${gc.code}`;
                      gcAutoPaid = true;
                      console.log(`[DEPOSIT] Fully auto-paid via gift card ${gc.code} (${gcDebit}c), balance: ${newBal}c`);
                    } else {
                      // Partial — GC deducted, remaining goes to pending_deposit for Stripe
                      gcPartialCents = gcDebit;
                      console.log(`[DEPOSIT] Partial auto-debit via gift card ${gc.code}: ${gcDebit}c of ${depResult.depCents}c, remaining ${depResult.depCents - gcDebit}c via Stripe, GC balance: ${newBal}c`);
                    }
                  }
                } catch (gcErr) {
                  console.error('[DEPOSIT] Gift card auto-debit failed:', gcErr.message);
                }
              }

              if (!gcAutoPaid) {
                const deadline = computeDepositDeadline(startDate, bizSettings);
                await client.query(
                  `UPDATE bookings SET status = 'pending_deposit', deposit_required = true,
                    deposit_amount_cents = $1, deposit_status = 'pending', deposit_deadline = $2,
                    deposit_requested_at = NOW(), deposit_request_count = 1,
                    confirmation_expires_at = NULL
                   WHERE id = $3 AND business_id = $4`,
                  [depResult.depCents, deadline.toISOString(), booking.rows[0].id, businessId]
                );
                booking.rows[0].status = 'pending_deposit';
                booking.rows[0].deposit_required = true;
                booking.rows[0].deposit_amount_cents = depResult.depCents;
                booking.rows[0].deposit_deadline = deadline.toISOString();
                console.log(`[DEPOSIT] Single-service deposit triggered (${depResult.reason}): ${depResult.depCents} cents, deadline: ${deadline.toISOString()}`);
              }
            }
          }
        } catch (depErr) {
          await client.query('ROLLBACK TO SAVEPOINT deposit_single_sp');
          console.error('Single-service deposit check failed:', depErr.message);
          // If deposit is enabled, abort the booking — don't let it slip through without deposit
          if (bizSettings.deposit_enabled) {
            throw new Error('Impossible de vérifier l\'acompte. Veuillez réessayer.');
          }
        }
      }

      // Queue notifications (skip email_confirmation if deposit active)
      if (booking.rows[0].status !== 'pending_deposit') {
        try {
          await client.query('SAVEPOINT notif_sp1');
          await client.query(
            `INSERT INTO notifications (business_id, booking_id, type, recipient_email, recipient_phone, status)
             VALUES ($1,$2,'email_confirmation',$3,$4,'queued')`,
            [businessId, booking.rows[0].id, client_email, client_phone]
          );
        } catch (notifErr) {
          await client.query('ROLLBACK TO SAVEPOINT notif_sp1');
          console.error('Notification insert failed:', notifErr.message);
        }
      }
      try {
        await client.query('SAVEPOINT notif_sp2');
        await client.query(
          `INSERT INTO notifications (business_id, booking_id, type, status)
           VALUES ($1,$2,'email_new_booking_pro','queued')`,
          [businessId, booking.rows[0].id]
        );
      } catch (notifErr) {
        await client.query('ROLLBACK TO SAVEPOINT notif_sp2');
        console.error('Notification insert failed:', notifErr.message);
      }

      return { booking: booking.rows[0], needsConfirmation, confirmTimeoutMin, confirmChannel, gcPartialCents, svcPrice, svcDuration };
    });

    const { booking: createdBooking, needsConfirmation: singleNeedsConfirm, confirmTimeoutMin: singleConfTimeout, confirmChannel: singleConfChannel, gcPartialCents: resultGcPartial, svcPrice: resultSvcPrice, svcDuration: resultSvcDuration } = result;

    broadcast(businessId, 'booking_update', { action: 'created', source: 'public' });
    // H1: calSyncPush for created booking
    try { const { calSyncPush } = require('../staff/bookings-helpers'); calSyncPush(businessId, createdBooking.id); } catch (_) {}

    // Send email (non-blocking): deposit request, confirmation request, OR direct confirmation
    (async () => {
      try {
        const bizRow = await query(`SELECT name, email, address, theme, settings, plan FROM businesses WHERE id = $1`, [businessId]);
        const pracRow = await query(`SELECT display_name FROM practitioners WHERE id = $1`, [practitioner_id]);
        if (bizRow.rows[0]) {
          // Fetch service name (+ variant name) for email
          let svcName = 'Rendez-vous';
          let svcCategory = null;
          if (effectiveServiceId) {
            const svcRow = await query(`SELECT name, category FROM services WHERE id = $1`, [effectiveServiceId]);
            if (svcRow.rows[0]) { svcName = svcRow.rows[0].name; svcCategory = svcRow.rows[0].category || null; }
            if (resolvedVariantId) {
              const vrRow = await query(`SELECT name FROM service_variants WHERE id = $1`, [resolvedVariantId]);
              if (vrRow.rows[0]?.name) svcName = svcName + ' \u2014 ' + vrRow.rows[0].name;
            }
          }
          const emailBooking = {
            ...createdBooking,
            client_name, client_email,
            service_name: svcName,
            service_category: svcCategory,
            practitioner_name: pracRow.rows[0]?.display_name || '',
            comment: client_comment,
            gc_partial_cents: resultGcPartial || 0,
            service_price_cents: resultSvcPrice || 0,
            duration_min: resultSvcDuration || 0
          };
          if (createdBooking.status === 'pending_deposit') {
            // Deposit auto-triggered: send deposit request email (payment serves as confirmation)
            const baseUrl = BASE_URL;
            const depositUrl = `${baseUrl}/deposit/${createdBooking.public_token}`;
            await query(`UPDATE bookings SET deposit_payment_url = $1 WHERE id = $2`, [depositUrl, createdBooking.id]);
            const { sendDepositRequestEmail } = require('../../services/email');
            const payUrl = `${baseUrl}/api/public/deposit/${createdBooking.public_token}/pay`;
            await sendDepositRequestEmail({ booking: emailBooking, business: bizRow.rows[0], depositUrl, payUrl });
            // Audit trail
            try {
              await query(
                `INSERT INTO notifications (business_id, booking_id, type, recipient_email, status, sent_at)
                 VALUES ($1,$2,'email_deposit_request',$3,'sent',NOW())`,
                [businessId, createdBooking.id, client_email]
              );
            } catch (_) { /* best-effort audit */ }
            // SMS with deposit payment link
            if (client_phone && ['pro', 'premium'].includes(bizRow.rows[0].plan)) {
              try {
                const { sendSMS } = require('../../services/sms');
                const _sd2 = new Date(emailBooking.start_at);
                const _sDate2 = _sd2.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
                const _sTime2 = _sd2.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
                const depAmt = (createdBooking.deposit_amount_cents / 100).toFixed(2).replace('.', ',');
                await sendSMS({ to: client_phone, body: `${bizRow.rows[0].name} : RDV le ${_sDate2} à ${_sTime2}. Acompte de ${depAmt}€ requis. Payez ici : ${depositUrl}`, businessId });
                try {
                  await query(
                    `INSERT INTO notifications (business_id, booking_id, type, recipient_phone, status, sent_at)
                     VALUES ($1,$2,'sms_deposit_request',$3,'sent',NOW())`,
                    [businessId, createdBooking.id, client_phone]
                  );
                } catch (_) {}
              } catch (smsErr) { console.warn('[SMS] Deposit request SMS error:', smsErr.message); }
            }
          } else if (singleNeedsConfirm) {
            const { sendBookingConfirmationRequest } = require('../../services/email');
            if (singleConfChannel === 'email' || singleConfChannel === 'both') {
              await sendBookingConfirmationRequest({ booking: emailBooking, business: bizRow.rows[0], timeoutMin: singleConfTimeout });
            }
            if (singleConfChannel === 'sms' || singleConfChannel === 'both') {
              try {
                const { sendSMS } = require('../../services/sms');
                const baseUrl = BASE_URL;
                const link = `${baseUrl}/api/public/booking/${createdBooking.public_token}/confirm-booking`;
                const _sd2 = new Date(emailBooking.start_at);
                const _sDate2 = _sd2.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
                const _sTime2 = _sd2.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
                console.log(`[SMS] Attempting confirmation SMS to ${client_phone} for booking ${createdBooking.id}, channel=${singleConfChannel}`);
                const smsResult = await sendSMS({ to: client_phone, body: `${bizRow.rows[0].name} : RDV le ${_sDate2} à ${_sTime2}. Répondez OUI pour confirmer ou cliquez ici : ${link}`, businessId });
                console.log(`[SMS] Confirmation SMS result:`, JSON.stringify(smsResult));
                await query(`INSERT INTO notifications (business_id, booking_id, type, recipient_phone, status, sent_at, error) VALUES ($1,$2,'sms_confirmation',$3,$4,NOW(),$5)`,
                  [businessId, createdBooking.id, client_phone, smsResult.success ? 'sent' : 'failed', smsResult.error || null]);
              } catch (smsErr) {
                console.error('[SMS] Booking confirm SMS error:', smsErr.message, smsErr.stack);
                try { await query(`INSERT INTO notifications (business_id, booking_id, type, recipient_phone, status, error) VALUES ($1,$2,'sms_confirmation',$3,'failed',$4)`,
                  [businessId, createdBooking.id, client_phone, smsErr.message]); } catch (_) {}
              }
            }
          } else {
            await sendBookingConfirmation({ booking: emailBooking, business: bizRow.rows[0] });
          }
        }
      } catch (e) { console.warn('[EMAIL] Single booking email error:', e.message); }
    })();

    res.status(201).json({
      booking: {
        id: createdBooking.id, token: createdBooking.public_token,
        start_at: createdBooking.start_at, end_at: createdBooking.end_at, status: createdBooking.status,
        discount_pct: createdBooking.discount_pct || null,
        deposit_amount_cents: createdBooking.deposit_amount_cents || null,
        cancel_url: `${BASE_URL}/booking/${createdBooking.public_token}`,
        promotion_label: createdBooking.promotion_label || null,
        promotion_discount_pct: createdBooking.promotion_discount_pct || null,
        promotion_discount_cents: createdBooking.promotion_discount_cents || 0
      },
      promotion: createdBooking.promotion_id ? {
        label: createdBooking.promotion_label,
        discount_pct: createdBooking.promotion_discount_pct,
        discount_cents: createdBooking.promotion_discount_cents
      } : null,
      needs_confirmation: singleNeedsConfirm && createdBooking.status !== 'pending_deposit'
    });
  } catch (err) {
    if (err.type === 'conflict') return res.status(409).json({ error: err.message });
    if (err.type === 'blocked') return res.status(403).json({ error: err.message, blocked: true });
    next(err);
  }
});

// Booking lookup, cancel, reschedule, ICS — unchanged from v1
// (import from separate file or keep inline)


// Minisite LAST — has /:slug catch-all
router.use('/', require('./minisite'));

module.exports = router;
