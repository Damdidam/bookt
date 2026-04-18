const router = require('express').Router();
const { query, pool } = require('../../services/db');

/**
 * Brevo event webhook.
 *
 * Brevo POSTs a JSON body (single event or array) to the configured URL. Format :
 *   {
 *     event: 'hard_bounce' | 'soft_bounce' | 'deferred' | 'delivered' | 'blocked' |
 *            'spam' | 'unique_opened' | 'opened' | 'clicks' | 'unsubscribed' | 'invalid_email' | 'complaint',
 *     email: 'recipient@example.com',
 *     'message-id': '<202...@smtp-relay.mailin.fr>',
 *     reason: '...', ts: 1616160000, date: '...', subject: '...', tag: '...'
 *   }
 *
 * Sécurité : Brevo ne signe pas ses webhooks — on exige un secret partagé dans le path
 * ou dans le header `x-brevo-secret` (configuré côté Brevo via "Additional parameters" ou
 * via un segment d'URL opaque).
 */
function validateBrevoSecret(req, res, next) {
  const expected = process.env.BREVO_WEBHOOK_SECRET;
  if (!expected) {
    // Si pas de secret configuré, on accepte mais on log — utile en dev.
    if (process.env.NODE_ENV === 'production') {
      console.error('[BREVO WH] BREVO_WEBHOOK_SECRET manquant en prod — refus');
      return res.status(503).json({ error: 'Service misconfigured' });
    }
    return next();
  }
  const provided = req.get('x-brevo-secret') || req.query.secret || req.params.secret;
  if (provided !== expected) {
    console.warn('[BREVO WH] Invalid secret');
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// Mappe l'événement Brevo vers (status final, terminal?)
// status ∈ {'sent', 'failed', 'queued'} — contrainte CHECK de la colonne.
function mapBrevoEvent(event) {
  const ev = String(event || '').toLowerCase().replace(/[-\s]/g, '_');
  switch (ev) {
    case 'delivered':
    case 'unique_opened':
    case 'opened':
    case 'clicks':
    case 'click':
      return { status: 'sent', terminal: true };
    case 'soft_bounce':
    case 'deferred':
      return { status: 'queued', terminal: false };
    case 'hard_bounce':
    case 'blocked':
    case 'spam':
    case 'complaint':
    case 'invalid_email':
    case 'error':
    case 'unsubscribed':
      return { status: 'failed', terminal: true };
    default:
      return { status: null, terminal: false };
  }
}

async function processBrevoEvent(evt) {
  const mapping = mapBrevoEvent(evt.event);
  if (!mapping.status) return { skipped: true, reason: 'unmapped_event', event: evt.event };

  const rawMsgId = evt['message-id'] || evt.message_id || evt.messageId;
  const messageId = rawMsgId ? String(rawMsgId).trim() : null;
  const email = evt.email ? String(evt.email).toLowerCase().trim() : null;
  const reason = evt.reason || evt.subject || null;
  const errorText = mapping.status === 'failed'
    ? `brevo_${String(evt.event).toLowerCase()}${reason ? ': ' + String(reason).substring(0, 200) : ''}`
    : null;

  // Stratégie de matching : messageId d'abord, sinon fallback sur email + recent.
  // Les événements arrivent en prod avec un léger décalage, on matche la notif la + récente.
  let updated = null;
  if (messageId) {
    const r = await query(
      `UPDATE notifications
         SET status = $1,
             error = COALESCE($2, error),
             sent_at = COALESCE(sent_at, CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END),
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('brevo_event', $3, 'brevo_ts', $4, 'brevo_reason', $5)
       WHERE provider = 'brevo' AND provider_message_id = $6
       RETURNING id`,
      [mapping.status, errorText, String(evt.event || ''), evt.ts || evt.ts_event || null, reason, messageId]
    );
    if (r.rowCount > 0) updated = r.rows[0].id;
  }
  if (!updated && email) {
    // Fallback : dernière notif pour cet email dans les 7 derniers jours sans event terminal.
    const r = await query(
      `UPDATE notifications
         SET status = $1,
             error = COALESCE($2, error),
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('brevo_event', $3, 'brevo_reason', $4, 'matched_by', 'email_fallback')
       WHERE id = (
         SELECT id FROM notifications
          WHERE LOWER(recipient_email) = $5
            AND created_at >= NOW() - INTERVAL '7 days'
          ORDER BY created_at DESC
          LIMIT 1
       )
       RETURNING id`,
      [mapping.status, errorText, String(evt.event || ''), reason, email]
    );
    if (r.rowCount > 0) updated = r.rows[0].id;
  }
  return { updated, status: mapping.status };
}

router.post('/', validateBrevoSecret, async (req, res) => {
  try {
    const body = req.body;
    const events = Array.isArray(body) ? body : (Array.isArray(body?.events) ? body.events : [body]);
    const results = [];
    for (const evt of events) {
      if (!evt || typeof evt !== 'object') continue;
      try {
        results.push(await processBrevoEvent(evt));
      } catch (e) {
        console.error('[BREVO WH] Event error:', e.message, evt);
        results.push({ error: e.message });
      }
    }
    res.json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error('[BREVO WH] Fatal error:', err.message);
    res.status(500).json({ error: 'processing_failed' });
  }
});

// Variante avec secret dans le path : /webhooks/brevo/s/:secret (pour Brevo qui
// ne supporte pas les headers custom sur certains plans).
router.post('/s/:secret', validateBrevoSecret, async (req, res) => {
  try {
    const body = req.body;
    const events = Array.isArray(body) ? body : (Array.isArray(body?.events) ? body.events : [body]);
    const results = [];
    for (const evt of events) {
      if (!evt || typeof evt !== 'object') continue;
      try {
        results.push(await processBrevoEvent(evt));
      } catch (e) {
        console.error('[BREVO WH] Event error:', e.message, evt);
        results.push({ error: e.message });
      }
    }
    res.json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error('[BREVO WH] Fatal error:', err.message);
    res.status(500).json({ error: 'processing_failed' });
  }
});

module.exports = router;
