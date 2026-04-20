'use strict';

const { normalizeEmail } = require('./helpers');

/**
 * 5-step client matching logic: OAuth > exact (phone+email) > phone > email > normalized email
 * Shared between multi-service and single-service booking flows.
 *
 * @param {object} txClient - The transaction database client
 * @param {object} params
 * @returns {Promise<{ clientId: string, existingClient: object|null }>}
 */
async function findOrCreateClient(txClient, {
  businessId, client_name, client_phone, client_email, client_bce,
  safeLang, consent_sms, consent_email, consent_marketing,
  oauth_provider, oauth_provider_id
}) {
  let clientId;
  let existingClient = null;
  let matchType = null;

  // Priority 1: OAuth provider match (most reliable identity)
  if (oauth_provider && oauth_provider_id) {
    const oauthMatch = await txClient.query(
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
    const exactMatch = await txClient.query(
      `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND phone = $2 AND LOWER(email) = LOWER($3) LIMIT 1`,
      [businessId, client_phone, client_email]
    );
    if (exactMatch.rows.length > 0) {
      existingClient = exactMatch.rows[0];
      matchType = 'exact';
    } else {
      const phoneMatch = await txClient.query(
        `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND phone = $2 LIMIT 1`,
        [businessId, client_phone]
      );
      if (phoneMatch.rows.length > 0) {
        existingClient = phoneMatch.rows[0];
        matchType = 'phone';
      } else {
        const emailMatch = await txClient.query(
          `SELECT id, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
          [businessId, client_email]
        );
        if (emailMatch.rows.length > 0) {
          existingClient = emailMatch.rows[0];
          matchType = 'email';
        } else {
          // Priority 5: Normalized email match (catches +tag aliases, Gmail dots)
          const normalizedInput = normalizeEmail(client_email);
          const allClients = await txClient.query(
            `SELECT id, email, is_blocked, no_show_count FROM clients WHERE business_id = $1 AND email IS NOT NULL`,
            [businessId]
          );
          const normalizedMatch = allClients.rows.find(c => normalizeEmail(c.email) === normalizedInput);
          if (normalizedMatch) {
            existingClient = normalizedMatch;
            matchType = 'email';
          }
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
      // H-01 RGPD fix: ne JAMAIS écraser un opt-out existant (consent=false) vers true via le flow
      // public. Depuis M-03 (consent implicite par remplissage form), le front envoie toujours true.
      // Sans cette garde, un client qui a explicitement opt-out (via dashboard pro ou précédent booking)
      // se voit ré-opt-in silencieusement au booking suivant = violation RGPD (droit à l'opposition).
      // Le pro peut toujours modifier via staff/clients.js PATCH s'il a une autorisation explicite.
      // P1-04 RGPD : capture before pour audit des modifications PII.
      const beforeExact = await txClient.query(
        `SELECT full_name, email, phone, bce_number, consent_sms, consent_email, consent_marketing FROM clients WHERE id = $1`,
        [clientId]
      );
      await txClient.query(
        `UPDATE clients SET
          full_name = COALESCE(full_name, NULLIF($1, '')),
          email = COALESCE(email, NULLIF($2, '')),
          phone = COALESCE(phone, NULLIF($3, '')),
          bce_number = COALESCE($4, bce_number),
          consent_sms = CASE WHEN consent_sms = false THEN false ELSE COALESCE($5, consent_sms) END,
          consent_email = CASE WHEN consent_email = false THEN false ELSE COALESCE($6, consent_email) END,
          consent_marketing = CASE WHEN consent_marketing = false THEN false ELSE COALESCE($7, consent_marketing) END,
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
      // P1-04 RGPD audit : re-SELECT pour capturer les valeurs réellement
      // écrites (logique COALESCE complexe côté SQL — plus fiable de SELECT
      // après UPDATE que de recomputer en JS).
      if (beforeExact.rows[0]) {
        const afterExact = await txClient.query(
          `SELECT full_name, email, phone, bce_number, consent_sms, consent_email, consent_marketing FROM clients WHERE id = $1`,
          [clientId]
        );
        const b = beforeExact.rows[0], a = afterExact.rows[0];
        const changedKeys = Object.keys(b).filter(k => String(b[k]) !== String(a[k]));
        if (changedKeys.length > 0) {
          try {
            const oldData = {}; const newData = { source: 'booking_exact_match' };
            changedKeys.forEach(k => { oldData[k] = b[k]; newData[k] = a[k]; });
            await txClient.query(
              `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
               VALUES ($1, NULL, 'client', $2, 'client_update_booking', $3, $4)`,
              [businessId, clientId, JSON.stringify(oldData), JSON.stringify(newData)]
            );
          } catch (e) { console.error('[AUDIT] booking exact match audit insert failed:', e.message); }
        }
      }
    } else if (matchType === 'phone' || matchType === 'email') {
      // Soft merge: only fill empty fields — merchant edits take priority
      // P1-04 RGPD : capture before pour audit.
      const beforeSoft = await txClient.query(
        `SELECT full_name, email, phone FROM clients WHERE id = $1 AND business_id = $2`,
        [clientId, businessId]
      );
      await txClient.query(
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
      if (beforeSoft.rows[0]) {
        const afterSoft = await txClient.query(
          `SELECT full_name, email, phone FROM clients WHERE id = $1 AND business_id = $2`,
          [clientId, businessId]
        );
        const b = beforeSoft.rows[0], a = afterSoft.rows[0];
        const changedKeys = Object.keys(b).filter(k => String(b[k]) !== String(a[k]));
        if (changedKeys.length > 0) {
          try {
            const oldData = {}; const newData = { source: `booking_${matchType}_match` };
            changedKeys.forEach(k => { oldData[k] = b[k]; newData[k] = a[k]; });
            await txClient.query(
              `INSERT INTO audit_logs (business_id, actor_user_id, entity_type, entity_id, action, old_data, new_data)
               VALUES ($1, NULL, 'client', $2, 'client_update_booking', $3, $4)`,
              [businessId, clientId, JSON.stringify(oldData), JSON.stringify(newData)]
            );
          } catch (e) { console.error('[AUDIT] booking soft match audit insert failed:', e.message); }
        }
      }
    }
  } else {
    // Insert new client — handle unique constraint violation (concurrent booking race)
    try {
      const nc = await txClient.query(
        `INSERT INTO clients (business_id, full_name, phone, email, bce_number,
          language_preference, consent_sms, consent_email, consent_marketing, created_from,
          oauth_provider, oauth_provider_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'booking',$10,$11) RETURNING id`,
        [businessId, client_name, client_phone, client_email, client_bce||null,
         safeLang, consent_sms===true, consent_email===true, consent_marketing===true,
         oauth_provider || null, oauth_provider_id || null]
      );
      clientId = nc.rows[0].id;
    } catch (insertErr) {
      // Unique constraint violation — another booking just created this client, fetch it
      if (insertErr.code === '23505') {
        const fallback = await txClient.query(
          `SELECT id, is_blocked FROM clients WHERE business_id = $1 AND (LOWER(email) = LOWER($2) OR phone = $3) LIMIT 1`,
          [businessId, client_email, client_phone]
        );
        if (fallback.rows.length > 0) {
          if (fallback.rows[0].is_blocked) {
            throw Object.assign(new Error('Votre compte est temporairement suspendu.'), { type: 'blocked', status: 403 });
          }
          clientId = fallback.rows[0].id;
        } else {
          throw insertErr; // re-throw if fallback also fails
        }
      } else {
        throw insertErr;
      }
    }
  }

  return { clientId, existingClient };
}

module.exports = { findOrCreateClient };
