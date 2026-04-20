const { pool } = require('./db');
const { sendEmail, buildEmailHTML, escHtml, safeColor } = require('./email-utils');

async function processExpiredPasses() {
  const result = await pool.query(
    `WITH expiring AS (
       SELECT id FROM passes
       WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < NOW()
       FOR UPDATE SKIP LOCKED
     )
     UPDATE passes SET status = 'expired', updated_at = NOW()
     FROM expiring WHERE passes.id = expiring.id
     RETURNING passes.id, passes.business_id, passes.buyer_email, passes.buyer_name, passes.name, passes.sessions_total, passes.sessions_remaining`
  );

  // Send expiry notification emails (non-blocking)
  for (const pass of result.rows) {
    try {
      const { rows } = await pool.query(
        `SELECT biz.name AS biz_name, biz.theme, biz.email AS biz_email, biz.address AS biz_address, biz.phone AS biz_phone, biz.slug AS biz_slug
         FROM businesses biz
         WHERE biz.id = $1`,
        [pass.business_id]
      );
      if (!rows[0]) continue;
      const { biz_name, theme, biz_email, biz_address, biz_phone, biz_slug } = rows[0];
      const client_email = pass.buyer_email;
      if (!client_email) { console.warn('[PASS EXPIRY] No buyer_email for pass ' + pass.id); continue; }
      const client_name = pass.buyer_name || 'Client';
      const color = safeColor(theme?.primary_color);
      const remaining = pass.sessions_remaining || 0;

      const bodyHTML = `
        <p>Bonjour${pass.buyer_name ? ' ' + escHtml(pass.buyer_name) : ''},</p>
        <p>Votre pass <strong>${escHtml(pass.name || 'Pass')}</strong> a expir\u00e9.</p>
        <div style="background:#FEF2F2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #EF4444">
          <div style="font-size:14px;color:#DC2626;font-weight:600;margin-bottom:4px">Pass expir\u00e9</div>
          <div style="font-size:13px;color:#3D3832">${remaining > 0 ? `${remaining} s\u00e9ance(s) restante(s) non utilis\u00e9e(s).` : 'Toutes les s\u00e9ances ont \u00e9t\u00e9 utilis\u00e9es.'}</div>
        </div>
        <p style="font-size:14px;color:#3D3832">N'h\u00e9sitez pas \u00e0 nous contacter pour renouveler votre pass${biz_phone ? ' au ' + escHtml(biz_phone) : ''}${biz_email ? ' (' + escHtml(biz_email) + ')' : ''}.</p>`;

      const _baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
      const html = buildEmailHTML({
        title: 'Pass expir\u00e9',
        // H7 fix: preheader escaped inside buildEmailHTML — pass raw
        preheader: `Votre pass "${pass.name || 'Pass'}" a expir\u00e9`,
        bodyHTML,
        ctaText: biz_slug ? 'Renouveler mon pass' : null,
        ctaUrl: biz_slug ? `${_baseUrl}/${biz_slug}/pass` : null,
        businessName: biz_name,
        primaryColor: color,
        footerText: `${biz_name}${biz_address ? ' \u00b7 ' + biz_address : ''} \u00b7 Via Genda.be`
      });

      await sendEmail({
        to: client_email,
        toName: client_name,
        subject: `Votre pass "${pass.name || 'Pass'}" a expir\u00e9 \u2014 ${biz_name}`,
        html,
        fromName: biz_name,
        replyTo: biz_email || undefined,
        businessId: pass.business_id
      });
    } catch (e) {
      console.warn('[PASS EXPIRY] Email error for pass', pass.id, ':', e.message);
    }
  }

  return { processed: result.rowCount };
}

/**
 * J-7 expiry warning for passes. Idempotent via expiry_warning_sent_at.
 * Bug B4 (memo H13) — prevents silent loss of remaining sessions.
 */
async function processPassExpiryWarnings() {
  // Batch 12 regression fix: same pattern as GC — flag posted AFTER successful send.
  const result = await pool.query(
    `SELECT id, business_id, buyer_email, buyer_name, name, code, sessions_remaining, expires_at
       FROM passes
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at > NOW()
        AND expires_at < NOW() + INTERVAL '7 days'
        AND expiry_warning_sent_at IS NULL
        AND COALESCE(sessions_remaining, 0) > 0
      LIMIT 200`
  );

  let sent = 0;
  for (const pass of result.rows) {
    try {
      const client_email = pass.buyer_email;
      if (!client_email) {
        await pool.query(`UPDATE passes SET expiry_warning_sent_at = NOW() WHERE id = $1 AND expiry_warning_sent_at IS NULL`, [pass.id]);
        continue;
      }
      const { rows } = await pool.query(
        `SELECT biz.name AS biz_name, biz.theme, biz.email AS biz_email, biz.address AS biz_address, biz.phone AS biz_phone, biz.slug AS biz_slug
         FROM businesses biz WHERE biz.id = $1`,
        [pass.business_id]
      );
      if (!rows[0]) continue;
      const { biz_name, theme, biz_email, biz_address, biz_phone, biz_slug } = rows[0];
      const color = safeColor(theme?.primary_color);
      const remaining = pass.sessions_remaining || 0;
      const expDate = new Date(pass.expires_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' });

      const bodyHTML = `
        <p>Bonjour${pass.buyer_name ? ' ' + escHtml(pass.buyer_name) : ''},</p>
        <p>Votre pass <strong>${escHtml(pass.name || 'Pass')}</strong> arrive bient\u00f4t \u00e0 expiration.</p>
        <div style="background:#FEF3C7;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #F59E0B">
          <div style="font-size:14px;color:#92400E;font-weight:600;margin-bottom:4px">Expiration le ${expDate}</div>
          <div style="font-size:13px;color:#3D3832"><strong>${remaining}</strong> s\u00e9ance(s) restante(s) non utilis\u00e9e(s).</div>
        </div>
        <p style="font-size:14px;color:#3D3832">N'h\u00e9sitez pas \u00e0 r\u00e9server avant cette date pour profiter de votre pass${biz_phone ? ' (' + escHtml(biz_phone) + ')' : ''}${biz_email ? ' \u2014 ' + escHtml(biz_email) : ''}.</p>`;

      const _baseUrl2 = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
      // CTA : réserver maintenant avec pre-fill du pass code pour utiliser les séances restantes.
      const ctaPassUrl = biz_slug
        ? `${_baseUrl2}/${biz_slug}/book?pass=${encodeURIComponent(pass.code || '')}`
        : null;
      const html = buildEmailHTML({
        title: 'Pass bient\u00f4t expir\u00e9',
        preheader: `Votre pass expire le ${expDate} \u2014 ${remaining} s\u00e9ance(s)`,
        bodyHTML,
        ctaText: ctaPassUrl ? 'R\u00e9server avec mon pass' : null,
        ctaUrl: ctaPassUrl,
        businessName: biz_name,
        primaryColor: color,
        footerText: `${biz_name}${biz_address ? ' \u00b7 ' + biz_address : ''} \u00b7 Via Genda.be`
      });

      await sendEmail({
        to: client_email,
        toName: pass.buyer_name || undefined,
        subject: `Votre pass expire le ${expDate} \u2014 ${biz_name}`,
        html,
        fromName: biz_name,
        replyTo: biz_email || undefined,
        businessId: pass.business_id
      });

      // Post flag AFTER successful send — retry on next tick if Brevo fails
      await pool.query(`UPDATE passes SET expiry_warning_sent_at = NOW() WHERE id = $1 AND expiry_warning_sent_at IS NULL`, [pass.id]);
      sent++;

      try {
        await pool.query(
          `INSERT INTO notifications (business_id, type, recipient_email, status, sent_at)
           VALUES ($1,'email_pass_expiry_warning',$2,'sent',NOW())`,
          [pass.business_id, client_email]
        );
      } catch (_) {}
    } catch (e) {
      console.warn('[PASS EXPIRY WARN] Email error for pass', pass.id, '— flag not posted, will retry:', e.message);
    }
  }

  return { processed: sent };
}

module.exports = { processExpiredPasses, processPassExpiryWarnings };
