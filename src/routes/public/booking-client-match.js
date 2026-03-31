'use strict';

/**
 * 4-step client matching logic: OAuth > exact (phone+email) > phone > email
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
      await txClient.query(
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
    }
  } else {
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
  }

  return { clientId, existingClient };
}

module.exports = { findOrCreateClient };
