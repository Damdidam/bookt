/**
 * Booking Annotations — notes, session notes, todos, reminders, documents.
 */
const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { blockIfImpersonated } = require('../../middleware/auth');

// BK-V13-005: UUID validation regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// CRT-16 to CRT-23: Helper to check practitioner scope on booking endpoints
async function checkPracScope(req, res, bid, bookingId) {
  if (!req.practitionerFilter) return true;
  const bk = await queryWithRLS(bid, 'SELECT practitioner_id FROM bookings WHERE id = $1 AND business_id = $2', [bookingId, bid]);
  if (bk.rows.length === 0) { res.status(404).json({ error: 'RDV introuvable' }); return false; }
  if (String(bk.rows[0].practitioner_id) !== String(req.practitionerFilter)) { res.status(403).json({ error: 'Accès interdit' }); return false; }
  return true;
}

// ============================================================
// PATCH /api/bookings/:id/note — Quick internal note
// UI: Calendar → event detail → internal note field
// ============================================================
router.patch('/:id/note', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { internal_note, color } = req.body;

    if (!(await checkPracScope(req, res, bid, id))) return;

    // Bug B4 fix: size limit on internal_note
    if (internal_note && internal_note.length > 10000) {
      return res.status(400).json({ error: 'Note interne trop longue (max 10000)' });
    }

    const sets = [];
    const params = [];
    let idx = 1;

    if (internal_note !== undefined) {
      sets.push(`internal_note = $${idx}`);
      params.push(internal_note);
      idx++;
    }
    if (color !== undefined) {
      if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) {
        return res.status(400).json({ error: 'Format de couleur invalide (ex: #FF5733)' });
      }
      sets.push(`color = $${idx}`);
      params.push(color);
      idx++;
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Rien à mettre à jour' });

    sets.push('updated_at = NOW()');
    params.push(id, bid);

    const result = await queryWithRLS(bid,
      `UPDATE bookings SET ${sets.join(', ')} WHERE id = $${idx} AND business_id = $${idx + 1} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    res.json({ updated: true, booking: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/bookings/:id/session-notes — Save session notes (rich text)
// UI: Calendar → event detail → Séance tab → Enregistrer
// ============================================================
router.patch('/:id/session-notes', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { session_notes } = req.body;

    if (!(await checkPracScope(req, res, bid, id))) return;

    if (session_notes && session_notes.length > 50000) {
      return res.status(400).json({ error: 'Notes de séance trop longues (max 50000 caractères)' });
    }

    const result = await queryWithRLS(bid,
      `UPDATE bookings SET session_notes = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3 RETURNING id`,
      [session_notes || null, id, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    res.json({ updated: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/bookings/:id/send-session-notes — Save + send session notes by email
// UI: Calendar → event detail → Séance tab → Envoyer
// ============================================================
router.post('/:id/send-session-notes', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'ID invalide' });
    const { session_notes } = req.body;

    if (!(await checkPracScope(req, res, bid, id))) return;

    if (!session_notes || session_notes.trim() === '' || session_notes.trim() === '<br>') {
      return res.status(400).json({ error: 'Notes de séance vides' });
    }
    if (session_notes.length > 50000) {
      return res.status(400).json({ error: 'Notes de séance trop longues (max 50000 caractères)' });
    }

    // Save notes first
    const saveResult = await queryWithRLS(bid,
      `UPDATE bookings SET session_notes = $1, updated_at = NOW()
       WHERE id = $2 AND business_id = $3 RETURNING id`,
      [session_notes, id, bid]
    );
    if (saveResult.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // Fetch booking + client + business info for email
    const detail = await queryWithRLS(bid,
      `SELECT b.start_at, b.session_notes,
              c.full_name AS client_name, c.email AS client_email,
              s.name AS service_name,
              p.display_name AS practitioner_name,
              biz.name AS business_name, biz.sector,
              (biz.theme->>'primary_color') AS primary_color,
              biz.address AS business_address, biz.phone AS business_phone, biz.email AS business_email
       FROM bookings b
       LEFT JOIN clients c ON c.id = b.client_id
       LEFT JOIN services s ON s.id = b.service_id
       JOIN practitioners p ON p.id = b.practitioner_id
       JOIN businesses biz ON biz.id = b.business_id
       WHERE b.id = $1 AND b.business_id = $2`,
      [id, bid]
    );

    if (detail.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });
    const d = detail.rows[0];

    if (!d.client_email) {
      return res.status(400).json({ error: 'Le client n\'a pas d\'adresse email' });
    }

    // Send email
    const { sendSessionNotesEmail } = require('../../services/email');
    const dateStr = new Date(d.start_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' });

    // Sanitize session notes before sending by email (strip scripts, event handlers, dangerous tags)
    // CRT-V12-009: Added picture|source to blocked tags
    const blocked = 'script|iframe|object|embed|form|textarea|input|select|button|svg|math|style|details|template|link|meta|base|img|video|audio|body|marquee|noscript|plaintext|xmp|listing|head|html|applet|layer|ilayer|bgsound|title|picture|source';
    let safeHTML = (session_notes || '');
    // CRT-19: Wrap tag removal in a do-while loop until stable (same pattern as event handler removal)
    let prevTag;
    do {
      prevTag = safeHTML;
      safeHTML = safeHTML.replace(new RegExp('<(' + blocked + ')[^>]*>[\\s\\S]*?<\\/\\1>', 'gi'), '');
      safeHTML = safeHTML.replace(new RegExp('<(' + blocked + ')[^>]*\\/?>', 'gi'), '');
    } while (safeHTML !== prevTag);
    // Remove event handlers — loop until stable to prevent chained handler bypass
    let prev;
    do {
      prev = safeHTML;
      // CRT-V11-4: Include < in character class to match frontend sanitizer (catches <onfocus= etc.)
      safeHTML = safeHTML.replace(/[\s"'\/<]on\s*\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
    } while (safeHTML !== prev);
    // Block javascript: protocol in href attributes
    safeHTML = safeHTML.replace(/href\s*=\s*["']?\s*javascript:/gi, 'href="');
    // Remove dangerous protocol URLs in href/src/action (including HTML-entity-encoded variants)
    safeHTML = safeHTML.replace(/(href|src|action)\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, (match, attr, val) => {
      // Decode HTML entities for protocol check
      const decoded = val.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
                         .replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
                         .replace(/&[a-z]+;/gi, '');
      if (/^\s*["']?\s*(javascript|data|vbscript|blob)\s*:/i.test(decoded)) {
        return attr + '=""';
      }
      return match;
    });
    // CRT-V10-6: Remove dangerous style attributes (expression, behavior, binding, url())
    safeHTML = safeHTML.replace(/\bstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, (match, val) => {
      if (/expression|behavior|binding|url\s*\(/i.test(val)) return '';
      return match;
    });
    // Add rel="noopener noreferrer" to all links
    safeHTML = safeHTML.replace(/<a\b([^>]*?)>/gi, (match, attrs) => {
      if (!/rel\s*=/i.test(attrs)) return `<a ${attrs} rel="noopener noreferrer">`;
      return match;
    });

    await sendSessionNotesEmail({
      to: d.client_email,
      toName: d.client_name,
      sessionHTML: safeHTML,
      serviceName: d.service_name || 'Rendez-vous',
      date: dateStr,
      practitionerName: d.practitioner_name,
      businessName: d.business_name,
      primaryColor: d.primary_color || '#0D7377',
      businessAddress: d.business_address,
      businessPhone: d.business_phone,
      businessEmail: d.business_email
    });

    // Update sent timestamp
    const upd = await queryWithRLS(bid,
      `UPDATE bookings SET session_notes_sent_at = NOW()
       WHERE id = $1 AND business_id = $2
       RETURNING session_notes_sent_at`,
      [id, bid]
    );

    res.json({ sent: true, sent_at: upd.rows[0]?.session_notes_sent_at });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// NOTES CRUD — POST / DELETE
// ============================================================
router.post('/:id/notes', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { content, is_pinned } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Contenu requis' });
    if (content.length > 5000) return res.status(400).json({ error: 'Contenu trop long (max 5000 caractères)' });

    if (!(await checkPracScope(req, res, bid, req.params.id))) return;

    // Verify booking exists
    const bkCheck = await queryWithRLS(bid, `SELECT id FROM bookings WHERE id = $1 AND business_id = $2`, [req.params.id, bid]);
    if (bkCheck.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // CRT-V12-008: Limit notes count per booking
    const noteCnt = await queryWithRLS(bid,
      `SELECT COUNT(*)::int AS cnt FROM booking_notes WHERE booking_id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    if (noteCnt.rows[0].cnt >= 50) return res.status(400).json({ error: 'Maximum 50 notes par RDV' });

    const result = await queryWithRLS(bid,
      `INSERT INTO booking_notes (booking_id, business_id, author_id, content, is_pinned)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, bid, req.user.id, content.trim(), is_pinned === true]
    );
    res.status(201).json({ note: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:bookingId/notes/:noteId', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    if (!UUID_RE.test(req.params.bookingId)) return res.status(400).json({ error: 'ID invalide' });
    if (!UUID_RE.test(req.params.noteId)) return res.status(400).json({ error: 'ID invalide' });

    if (!(await checkPracScope(req, res, bid, req.params.bookingId))) return;

    const result = await queryWithRLS(bid,
      `DELETE FROM booking_notes WHERE id = $1 AND booking_id = $2 AND business_id = $3 AND (author_id = $4 OR $5 = 'owner') RETURNING id`,
      [req.params.noteId, req.params.bookingId, bid, req.user.id, req.user.role]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note introuvable' });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// TODOS CRUD — POST / PATCH / DELETE
// ============================================================
router.post('/:id/todos', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Contenu requis' });
    if (content.length > 5000) return res.status(400).json({ error: 'Contenu trop long (max 5000 caractères)' });

    if (!(await checkPracScope(req, res, bid, req.params.id))) return;

    // Verify booking exists
    const bkCheck = await queryWithRLS(bid, `SELECT id FROM bookings WHERE id = $1 AND business_id = $2`, [req.params.id, bid]);
    if (bkCheck.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    // CRT-V12-008: Limit todos count per booking
    const todoCnt = await queryWithRLS(bid,
      `SELECT COUNT(*)::int AS cnt FROM practitioner_todos WHERE booking_id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    if (todoCnt.rows[0].cnt >= 50) return res.status(400).json({ error: 'Maximum 50 tâches par RDV' });

    const result = await queryWithRLS(bid,
      `INSERT INTO practitioner_todos (booking_id, business_id, user_id, content)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, bid, req.user.id, content.trim()]
    );
    res.status(201).json({ todo: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/:bookingId/todos/:todoId', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    if (!UUID_RE.test(req.params.bookingId)) return res.status(400).json({ error: 'ID invalide' });
    if (!UUID_RE.test(req.params.todoId)) return res.status(400).json({ error: 'ID invalide' });
    const { is_done, content } = req.body;

    if (!(await checkPracScope(req, res, bid, req.params.bookingId))) return;

    // CRT-V10-3: Validate is_done type
    if (is_done !== undefined && typeof is_done !== 'boolean') {
      return res.status(400).json({ error: 'is_done doit être un booléen' });
    }

    const sets = [];
    const params = [];
    let idx = 1;

    if (is_done !== undefined) {
      sets.push(`is_done = $${idx}`);
      params.push(is_done);
      idx++;
      if (is_done) {
        sets.push(`done_at = NOW()`);
      } else {
        sets.push(`done_at = NULL`);
      }
    }
    // CRT-V12-006: Reject empty/whitespace content
    if (content !== undefined) {
      if (!content || !content.trim()) return res.status(400).json({ error: 'Contenu requis' });
      if (content.length > 5000) return res.status(400).json({ error: 'Contenu trop long (max 5000 caractères)' });
      sets.push(`content = $${idx}`);
      params.push(content.trim());
      idx++;
    }

    if (sets.length === 0) return res.status(400).json({ error: 'Rien à mettre à jour' });

    // CRT-V12-005: Add ownership check matching DELETE pattern
    params.push(req.params.todoId, req.params.bookingId, bid, req.user.id, req.user.role);
    const result = await queryWithRLS(bid,
      `UPDATE practitioner_todos SET ${sets.join(', ')}
       WHERE id = $${idx} AND booking_id = $${idx + 1} AND business_id = $${idx + 2}
       AND (user_id = $${idx + 3} OR $${idx + 4} = 'owner')
       RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });
    res.json({ todo: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:bookingId/todos/:todoId', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    if (!UUID_RE.test(req.params.bookingId)) return res.status(400).json({ error: 'ID invalide' });
    if (!UUID_RE.test(req.params.todoId)) return res.status(400).json({ error: 'ID invalide' });

    if (!(await checkPracScope(req, res, bid, req.params.bookingId))) return;

    const result = await queryWithRLS(bid,
      `DELETE FROM practitioner_todos WHERE id = $1 AND booking_id = $2 AND business_id = $3 AND (user_id = $4 OR $5 = 'owner') RETURNING id`,
      [req.params.todoId, req.params.bookingId, bid, req.user.id, req.user.role]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tâche introuvable' });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// REMINDERS CRUD — POST / DELETE
// ============================================================
router.post('/:id/reminders', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { offset_minutes, channel, message } = req.body;
    if (message && message.length > 5000) return res.status(400).json({ error: 'Message trop long (max 5000 caractères)' });
    const offset = Math.min(10080, Math.max(1, parseInt(offset_minutes) || 30)); // 1 min to 7 days
    const ch = ['browser', 'email', 'both'].includes(channel) ? channel : 'browser';

    if (!(await checkPracScope(req, res, bid, req.params.id))) return;

    // Get booking start time to calculate remind_at
    const bk = await queryWithRLS(bid,
      `SELECT start_at FROM bookings WHERE id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    if (bk.rows.length === 0) return res.status(404).json({ error: 'RDV introuvable' });

    const remindAt = new Date(new Date(bk.rows[0].start_at).getTime() - offset * 60000);

    // CRT-V10-12: Reminder count limit
    const cnt = await queryWithRLS(bid,
      `SELECT COUNT(*)::int AS cnt FROM booking_reminders WHERE booking_id = $1 AND business_id = $2`,
      [req.params.id, bid]
    );
    if (cnt.rows[0].cnt >= 10) return res.status(400).json({ error: 'Maximum 10 rappels par RDV' });

    // CRT-V10-13: Past reminder validation
    if (remindAt <= new Date()) {
      return res.status(400).json({ error: 'Le rappel serait dans le passé' });
    }

    const result = await queryWithRLS(bid,
      `INSERT INTO booking_reminders (booking_id, business_id, user_id, remind_at, offset_minutes, channel, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.id, bid, req.user.id, remindAt.toISOString(), offset, ch, message || null]
    );
    res.status(201).json({ reminder: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:bookingId/reminders/:reminderId', blockIfImpersonated, async (req, res, next) => {
  try {
    const bid = req.businessId;
    if (!UUID_RE.test(req.params.bookingId)) return res.status(400).json({ error: 'ID invalide' });
    if (!UUID_RE.test(req.params.reminderId)) return res.status(400).json({ error: 'ID invalide' });

    if (!(await checkPracScope(req, res, bid, req.params.bookingId))) return;

    const result = await queryWithRLS(bid,
      `DELETE FROM booking_reminders WHERE id = $1 AND booking_id = $2 AND business_id = $3 RETURNING id`,
      [req.params.reminderId, req.params.bookingId, bid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rappel introuvable' });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
