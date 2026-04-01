/**
 * Gift card expiry — auto-expire active gift cards past their expiration date.
 * Runs periodically via cron in server.js.
 */
const { query } = require('./db');
const { sendEmail, buildEmailHTML, escHtml, safeColor } = require('./email-utils');

async function processExpiredGiftCards() {
  const result = await query(
    `UPDATE gift_cards SET status = 'expired', updated_at = NOW()
     WHERE status = 'active' AND expires_at < NOW()
     RETURNING id, code, business_id, amount_cents, balance_cents, recipient_email, recipient_name, buyer_email, buyer_name`
  );

  // Send expiry notification emails (non-blocking)
  for (const gc of result.rows) {
    try {
      if (!gc.recipient_email) continue;
      const bizResult = await query(
        `SELECT name, theme, address, phone, email FROM businesses WHERE id = $1`,
        [gc.business_id]
      );
      if (!bizResult.rows[0]) continue;
      const { name: biz_name, theme: biz_theme, address: biz_address, phone: biz_phone, email: biz_email } = bizResult.rows[0];
      const color = safeColor(biz_theme?.primary_color);
      const balanceStr = ((gc.balance_cents || 0) / 100).toFixed(2).replace('.', ',') + ' \u20ac';
      const amountStr = ((gc.amount_cents || 0) / 100).toFixed(2).replace('.', ',') + ' \u20ac';

      const bodyHTML = `
        <p>Votre carte cadeau <strong>${escHtml(gc.code || '')}</strong> a expir\u00e9.</p>
        <div style="background:#FEF2F2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #EF4444">
          <div style="font-size:14px;color:#DC2626;font-weight:600;margin-bottom:4px">Carte cadeau expir\u00e9e</div>
          <div style="font-size:13px;color:#3D3832">Montant initial : ${amountStr}</div>
          ${gc.balance_cents > 0 ? `<div style="font-size:13px;color:#DC2626;margin-top:4px">Solde restant non utilis\u00e9 : ${balanceStr}</div>` : `<div style="font-size:13px;color:#3D3832;margin-top:4px">Le solde a \u00e9t\u00e9 enti\u00e8rement utilis\u00e9.</div>`}
        </div>
        <p style="font-size:14px;color:#3D3832">N'h\u00e9sitez pas \u00e0 nous contacter pour toute question${biz_phone ? ' au ' + escHtml(biz_phone) : ''}${biz_email ? ' (' + escHtml(biz_email) + ')' : ''}.</p>`;

      const html = buildEmailHTML({
        title: 'Carte cadeau expir\u00e9e',
        preheader: `Votre carte cadeau ${escHtml(gc.code || '')} a expir\u00e9`,
        bodyHTML,
        businessName: biz_name,
        primaryColor: color,
        footerText: `${escHtml(biz_name)}${biz_address ? ' \u00b7 ' + escHtml(biz_address) : ''} \u00b7 Via Genda.be`
      });

      await sendEmail({
        to: gc.recipient_email,
        toName: gc.recipient_name || undefined,
        subject: `Votre carte cadeau a expir\u00e9 \u2014 ${biz_name}`,
        html,
        fromName: biz_name,
        replyTo: biz_email || undefined
      });

      // Also notify the buyer if different from recipient
      if (gc.buyer_email && gc.buyer_email !== gc.recipient_email) {
        await sendEmail({
          to: gc.buyer_email,
          toName: gc.buyer_name || undefined,
          subject: `Carte cadeau expir\u00e9e \u2014 ${biz_name}`,
          html,
          fromName: biz_name,
          replyTo: biz_email || undefined
        });
      }
    } catch (e) {
      console.warn('[GC EXPIRY] Email error for gift card', gc.id, ':', e.message);
    }
  }

  return { processed: result.rows.length };
}

module.exports = { processExpiredGiftCards };
