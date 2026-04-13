/**
 * Gift card expiry — auto-expire active gift cards past their expiration date.
 * Runs periodically via cron in server.js.
 */
const { query } = require('./db');
const { sendEmail, buildEmailHTML, escHtml, safeColor } = require('./email-utils');

async function processExpiredGiftCards() {
  const result = await query(
    `WITH expiring AS (
       SELECT id FROM gift_cards
       WHERE status = 'active' AND expires_at < NOW()
       FOR UPDATE SKIP LOCKED
     )
     UPDATE gift_cards SET status = 'expired', updated_at = NOW()
     FROM expiring WHERE gift_cards.id = expiring.id
     RETURNING gift_cards.id, gift_cards.code, gift_cards.business_id, gift_cards.amount_cents, gift_cards.balance_cents, gift_cards.recipient_email, gift_cards.recipient_name, gift_cards.buyer_email, gift_cards.buyer_name`
  );

  // Send expiry notification emails (non-blocking)
  for (const gc of result.rows) {
    try {
      // Skip if no email at all (neither recipient nor buyer)
      if (!gc.recipient_email && !gc.buyer_email) continue;
      // For self-purchased GCs where only buyer_email is set, use that as recipient
      const primaryEmail = gc.recipient_email || gc.buyer_email;
      const primaryName = gc.recipient_name || gc.buyer_name || '';
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
        <p>Bonjour${primaryName ? ' ' + escHtml(primaryName) : ''},</p>
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
        footerText: `${biz_name}${biz_address ? ' \u00b7 ' + biz_address : ''} \u00b7 Via Genda.be`
      });

      await sendEmail({
        to: primaryEmail,
        toName: primaryName || undefined,
        subject: `Votre carte cadeau a expir\u00e9 \u2014 ${biz_name}`,
        html,
        fromName: biz_name,
        replyTo: biz_email || undefined
      });

      // Also notify the buyer if different from primary recipient
      if (gc.buyer_email && gc.buyer_email !== primaryEmail) {
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

/**
 * J-7 expiry warning — sends a heads-up email to recipient (and buyer if different)
 * 7 days before a gift card expires. Idempotent via expiry_warning_sent_at.
 * Bug B4 (memo H13) — prevents silent loss of remaining balance.
 */
async function processGiftCardExpiryWarnings() {
  const result = await query(
    `UPDATE gift_cards
        SET expiry_warning_sent_at = NOW()
      WHERE id IN (
        SELECT id FROM gift_cards
         WHERE status = 'active'
           AND expires_at IS NOT NULL
           AND expires_at > NOW()
           AND expires_at < NOW() + INTERVAL '7 days'
           AND expiry_warning_sent_at IS NULL
           AND COALESCE(balance_cents, 0) > 0
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, code, business_id, balance_cents, amount_cents, expires_at,
                recipient_email, recipient_name, buyer_email, buyer_name`
  );

  for (const gc of result.rows) {
    try {
      if (!gc.recipient_email && !gc.buyer_email) continue;
      const primaryEmail = gc.recipient_email || gc.buyer_email;
      const primaryName = gc.recipient_name || gc.buyer_name || '';
      const bizResult = await query(
        `SELECT name, theme, address, phone, email FROM businesses WHERE id = $1`,
        [gc.business_id]
      );
      if (!bizResult.rows[0]) continue;
      const { name: biz_name, theme: biz_theme, address: biz_address, phone: biz_phone, email: biz_email } = bizResult.rows[0];
      const color = safeColor(biz_theme?.primary_color);
      const balanceStr = ((gc.balance_cents || 0) / 100).toFixed(2).replace('.', ',') + ' \u20ac';
      const expDate = new Date(gc.expires_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' });

      const bodyHTML = `
        <p>Bonjour${primaryName ? ' ' + escHtml(primaryName) : ''},</p>
        <p>Votre carte cadeau <strong>${escHtml(gc.code || '')}</strong> arrive bient\u00f4t \u00e0 expiration.</p>
        <div style="background:#FEF3C7;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #F59E0B">
          <div style="font-size:14px;color:#92400E;font-weight:600;margin-bottom:4px">Expiration le ${expDate}</div>
          <div style="font-size:13px;color:#3D3832">Solde restant : <strong>${balanceStr}</strong></div>
        </div>
        <p style="font-size:14px;color:#3D3832">N'h\u00e9sitez pas \u00e0 r\u00e9server avant cette date pour utiliser votre solde${biz_phone ? ' (' + escHtml(biz_phone) + ')' : ''}${biz_email ? ' \u2014 ' + escHtml(biz_email) : ''}.</p>`;

      const html = buildEmailHTML({
        title: 'Carte cadeau bient\u00f4t expir\u00e9e',
        preheader: `Votre carte cadeau expire le ${expDate} \u2014 solde ${balanceStr}`,
        bodyHTML,
        businessName: biz_name,
        primaryColor: color,
        footerText: `${biz_name}${biz_address ? ' \u00b7 ' + biz_address : ''} \u00b7 Via Genda.be`
      });

      await sendEmail({
        to: primaryEmail,
        toName: primaryName || undefined,
        subject: `Votre carte cadeau expire le ${expDate} \u2014 ${biz_name}`,
        html,
        fromName: biz_name,
        replyTo: biz_email || undefined
      });

      if (gc.buyer_email && gc.buyer_email !== primaryEmail) {
        await sendEmail({
          to: gc.buyer_email,
          toName: gc.buyer_name || undefined,
          subject: `Carte cadeau bient\u00f4t expir\u00e9e \u2014 ${biz_name}`,
          html,
          fromName: biz_name,
          replyTo: biz_email || undefined
        });
      }

      try {
        await query(
          `INSERT INTO notifications (business_id, type, recipient_email, status, sent_at)
           VALUES ($1,'email_giftcard_expiry_warning',$2,'sent',NOW())`,
          [gc.business_id, primaryEmail]
        );
      } catch (_) {}
    } catch (e) {
      console.warn('[GC EXPIRY WARN] Email error for gift card', gc.id, ':', e.message);
    }
  }

  return { processed: result.rows.length };
}

module.exports = { processExpiredGiftCards, processGiftCardExpiryWarnings };
