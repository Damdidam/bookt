const { pool } = require('./db');
const { sendEmail, buildEmailHTML, escHtml, safeColor } = require('./email-utils');

async function processExpiredPasses() {
  const result = await pool.query(
    `UPDATE passes SET status = 'expired', updated_at = NOW()
     WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < NOW()
     RETURNING id, business_id, buyer_email, name, sessions_total, sessions_remaining`
  );

  // Send expiry notification emails (non-blocking)
  for (const pass of result.rows) {
    try {
      const { rows } = await pool.query(
        `SELECT biz.name AS biz_name, biz.theme, biz.email AS biz_email, biz.address AS biz_address, biz.phone AS biz_phone
         FROM businesses biz
         WHERE biz.id = $1`,
        [pass.business_id]
      );
      if (!rows[0]) continue;
      const { biz_name, theme, biz_email, biz_address, biz_phone } = rows[0];
      const client_email = pass.buyer_email;
      const client_name = pass.name || 'Client';
      const color = safeColor(theme?.primary_color);
      const remaining = pass.sessions_remaining || 0;

      const bodyHTML = `
        <p>Votre pass <strong>${escHtml(pass.name || 'Pass')}</strong> a expir\u00e9.</p>
        <div style="background:#FEF2F2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #EF4444">
          <div style="font-size:14px;color:#DC2626;font-weight:600;margin-bottom:4px">Pass expir\u00e9</div>
          <div style="font-size:13px;color:#3D3832">${remaining > 0 ? `${remaining} s\u00e9ance(s) restante(s) non utilis\u00e9e(s).` : 'Toutes les s\u00e9ances ont \u00e9t\u00e9 utilis\u00e9es.'}</div>
        </div>
        <p style="font-size:14px;color:#3D3832">N'h\u00e9sitez pas \u00e0 nous contacter pour renouveler votre pass${biz_phone ? ' au ' + escHtml(biz_phone) : ''}${biz_email ? ' (' + escHtml(biz_email) + ')' : ''}.</p>`;

      const html = buildEmailHTML({
        title: 'Pass expir\u00e9',
        preheader: `Votre pass "${escHtml(pass.name || 'Pass')}" a expir\u00e9`,
        bodyHTML,
        businessName: biz_name,
        primaryColor: color,
        footerText: `${escHtml(biz_name)}${biz_address ? ' \u00b7 ' + escHtml(biz_address) : ''} \u00b7 Via Genda.be`
      });

      await sendEmail({
        to: client_email,
        toName: client_name,
        subject: `Votre pass "${pass.name || 'Pass'}" a expir\u00e9 \u2014 ${biz_name}`,
        html,
        fromName: biz_name,
        replyTo: biz_email || undefined
      });
    } catch (e) {
      console.warn('[PASS EXPIRY] Email error for pass', pass.id, ':', e.message);
    }
  }

  return { processed: result.rowCount };
}

module.exports = { processExpiredPasses };
