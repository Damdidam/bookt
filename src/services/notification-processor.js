/**
 * Notification Processor — processes queued pro notifications
 * Handles: email_new_booking_pro, email_cancellation_pro, email_reschedule_pro,
 *          email_modification_confirmed, email_modification_rejected
 */

const { pool } = require('./db');
const { sendEmail, buildEmailHTML, escHtml, safeColor } = require('./email');

/** Format a Date to "HH:MM" in Brussels timezone */
function fmtTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
}

/** Format a Date to a readable date string in Brussels timezone */
function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Format price cents to display string */
function fmtPrice(cents) {
  if (!cents || cents <= 0) return '';
  return (cents / 100).toFixed(2).replace('.', ',') + ' \u20ac';
}

/**
 * Fetch full booking + business + client + service data for a notification
 */
async function fetchBookingData(bookingId) {
  const { rows } = await pool.query(
    `SELECT b.*,
            CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS service_name,
            s.category AS service_category,
            COALESCE(sv.price_cents, s.price_cents, 0) AS service_price_cents,
            COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
            p.display_name AS practitioner_name,
            c.full_name AS client_name, c.email AS client_email, c.phone AS client_phone,
            biz.name AS biz_name, biz.email AS biz_email, biz.phone AS biz_phone,
            biz.address AS biz_address, biz.theme AS biz_theme, biz.slug AS biz_slug,
            biz.settings AS biz_settings
     FROM bookings b
     LEFT JOIN services s ON s.id = b.service_id
     LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
     LEFT JOIN practitioners p ON p.id = b.practitioner_id
     LEFT JOIN clients c ON c.id = b.client_id
     JOIN businesses biz ON biz.id = b.business_id
     WHERE b.id = $1`,
    [bookingId]
  );
  return rows[0] || null;
}

/**
 * Fetch group services for multi-service bookings
 */
async function fetchGroupServices(groupId, businessId) {
  if (!groupId) return null;
  const { rows } = await pool.query(
    `SELECT b.id, b.start_at, b.end_at,
            CASE WHEN sv.name IS NOT NULL THEN s.name || ' \u2014 ' || sv.name ELSE s.name END AS name,
            s.category,
            COALESCE(sv.price_cents, s.price_cents, 0) AS price_cents,
            COALESCE(sv.duration_min, s.duration_min, 0) AS duration_min,
            p.display_name AS practitioner_name,
            b.discount_pct
     FROM bookings b
     LEFT JOIN services s ON s.id = b.service_id
     LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
     LEFT JOIN practitioners p ON p.id = b.practitioner_id
     WHERE b.group_id = $1 AND b.business_id = $2
     ORDER BY b.start_at`,
    [groupId, businessId]
  );
  return rows.length > 1 ? rows : null;
}

/**
 * Build service detail HTML block for pro emails
 */
function buildServiceDetailHTML(bk, groupServices) {
  const isMulti = Array.isArray(groupServices) && groupServices.length > 1;

  if (isMulti) {
    let html = '';
    groupServices.forEach(s => {
      // Apply last-minute discount per member
      const adjMemberPrice = s.discount_pct && s.price_cents ? Math.round(s.price_cents * (100 - s.discount_pct) / 100) : (s.price_cents || 0);
      const price = fmtPrice(adjMemberPrice);
      const pracSuffix = s.practitioner_name ? ' \u00b7 ' + escHtml(s.practitioner_name) : '';
      html += `<div style="font-size:13px;color:#3D3832;padding:2px 0">\u2022 ${escHtml(s.name)} \u2014 ${s.duration_min} min${price ? ' \u00b7 ' + price : ''}${pracSuffix}</div>`;
    });
    const totalMin = groupServices.reduce((sum, s) => sum + (s.duration_min || 0), 0);
    const totalPrice = groupServices.reduce((sum, s) => {
      const adj = s.discount_pct && s.price_cents ? Math.round(s.price_cents * (100 - s.discount_pct) / 100) : (s.price_cents || 0);
      return sum + adj;
    }, 0);
    const promoDisc = bk.promotion_discount_cents || 0;
    const finalPrice = totalPrice - promoDisc;
    const durStr = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' + (totalMin % 60 > 0 ? String(totalMin % 60).padStart(2, '0') : '') : totalMin + ' min';
    if (totalPrice > 0) {
      if (promoDisc > 0 && bk.promotion_label) {
        html += `<div style="font-size:14px;color:#3D3832;margin-top:6px;font-weight:700">Total : ${durStr} \u00b7 <s style="opacity:.6">${fmtPrice(totalPrice)}</s> ${fmtPrice(finalPrice)}</div>`;
        html += `<div style="font-size:12px;color:#6B6560;opacity:.8">${escHtml(bk.promotion_label)} : -${fmtPrice(promoDisc)}</div>`;
      } else {
        html += `<div style="font-size:14px;color:#3D3832;margin-top:6px;font-weight:700">Total : ${durStr} \u00b7 ${fmtPrice(totalPrice)}</div>`;
      }
    }
    return html;
  }

  // Single service
  const serviceName = escHtml(bk.service_category ? bk.service_category + ' - ' + bk.service_name : (bk.service_name || 'Rendez-vous'));
  let html = `<div style="font-size:14px;color:#3D3832;font-weight:600">${serviceName}</div>`;
  const _rawPriceCents = bk.service_price_cents || 0;
  const priceCents = bk.discount_pct ? Math.round(_rawPriceCents * (100 - bk.discount_pct) / 100) : _rawPriceCents;
  if (priceCents > 0) {
    const dur = bk.duration_min ? bk.duration_min + ' min \u00b7 ' : '';
    const promoDisc = bk.promotion_discount_cents || 0;
    if (promoDisc > 0 && bk.promotion_label) {
      const finalPrice = priceCents - promoDisc;
      html += `<div style="font-size:13px;color:#6B6560;margin-top:4px">${dur}<s style="opacity:.6">${fmtPrice(priceCents)}</s> ${fmtPrice(finalPrice)}</div>`;
      html += `<div style="font-size:12px;color:#6B6560;opacity:.8">${escHtml(bk.promotion_label)} : -${fmtPrice(promoDisc)}</div>`;
    } else {
      html += `<div style="font-size:13px;color:#6B6560;margin-top:4px">${dur}${fmtPrice(priceCents)}</div>`;
    }
  }
  if (bk.practitioner_name) {
    html += `<div style="font-size:13px;color:#6B6560;margin-top:2px">Praticien : ${escHtml(bk.practitioner_name)}</div>`;
  }
  return html;
}

// ============================================================
// EMAIL BUILDERS — one per notification type
// ============================================================

/**
 * email_post_rdv — Send review request email (deferred via delay_until)
 */
async function sendReviewEmail(bk, metadata) {
  if (!bk.client_email) return { success: false, error: 'no_client_email' };
  const reviewToken = metadata?.review_token;
  if (!reviewToken) return { success: false, error: 'no_review_token' };

  const { sendReviewRequestEmail } = require('./email-misc');
  const firstName = (bk.client_name || '').split(' ')[0] || 'Client';
  return sendReviewRequestEmail({
    booking: {
      client_name: bk.client_name,
      client_email: bk.client_email,
      first_name: firstName,
      service_name: bk.service_name,
      service_category: bk.service_category,
      practitioner_name: bk.practitioner_name,
      review_token: reviewToken,
      start_at: bk.start_at
    },
    business: {
      name: bk.biz_name,
      email: bk.biz_email,
      address: bk.biz_address,
      theme: bk.biz_theme,
      settings: bk.biz_settings || {}
    }
  });
}

/**
 * email_new_booking_pro — Notify merchant of a new booking
 */
async function sendNewBookingProEmail(bk, groupServices) {
  const color = safeColor(bk.biz_theme?.primary_color);
  const dateStr = fmtDate(bk.start_at);
  const timeStr = fmtTime(bk.start_at);
  const endTimeStr = fmtTime(bk.end_at);
  const clientName = escHtml(bk.client_name || 'Client');
  const clientEmail = escHtml(bk.client_email || '');
  const clientPhone = escHtml(bk.client_phone || '');

  const serviceHTML = buildServiceDetailHTML(bk, groupServices);

  // Deposit info
  let depositHTML = '';
  if (bk.deposit_required && bk.deposit_amount_cents > 0) {
    const depAmt = fmtPrice(bk.deposit_amount_cents);
    const isPaid = !!bk.deposit_paid_at;
    depositHTML = `
    <div style="background:${isPaid ? '#F0FDF4' : '#FEF3E2'};border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid ${isPaid ? '#22C55E' : '#F59E0B'}">
      <div style="font-size:13px;color:${isPaid ? '#15803D' : '#92700C'};font-weight:600">Acompte : ${depAmt} ${isPaid ? '(pay\u00e9)' : '(en attente)'}</div>
    </div>`;
  }

  const bodyHTML = `
    <p>Nouvelle r\u00e9servation re\u00e7ue !</p>
    <div style="background:#F0F9FF;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid ${color}">
      <div style="font-size:15px;font-weight:600;color:#1A1816;margin-bottom:6px">${dateStr}</div>
      <div style="font-size:14px;color:#3D3832;margin-bottom:8px">${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceHTML}
    </div>
    <div style="background:#F5F4F1;border-radius:8px;padding:12px 16px;margin:12px 0">
      <div style="font-size:13px;color:#6B6560;margin-bottom:4px"><strong>Client :</strong> ${clientName}</div>
      ${clientEmail ? `<div style="font-size:13px;color:#6B6560">${clientEmail}</div>` : ''}
      ${clientPhone ? `<div style="font-size:13px;color:#6B6560">${clientPhone}</div>` : ''}
    </div>
    ${depositHTML}
    ${bk.comment_client ? `<div style="background:#FFFBEB;border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid #F59E0B"><div style="font-size:13px;color:#92700C"><strong>Note du client :</strong> ${escHtml(bk.comment_client)}</div></div>` : ''}`;

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const html = buildEmailHTML({
    title: 'Nouveau rendez-vous',
    preheader: `${clientName} \u2014 ${dateStr} \u00e0 ${timeStr}`,
    bodyHTML,
    ctaText: 'Voir dans le dashboard',
    ctaUrl: `${baseUrl}/dashboard`,
    businessName: bk.biz_name,
    primaryColor: color,
    footerText: `${bk.biz_name} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: bk.biz_email,
    toName: bk.biz_name,
    subject: `Nouveau RDV \u2014 ${clientName} \u2014 ${fmtDate(bk.start_at)}`,
    html,
    fromName: 'Genda',
    replyTo: bk.client_email || undefined
  });
}

/**
 * email_cancellation_pro — Notify merchant of a client cancellation
 */
async function sendCancellationProEmail(bk, groupServices) {
  const color = safeColor(bk.biz_theme?.primary_color);
  const dateStr = fmtDate(bk.start_at);
  const timeStr = fmtTime(bk.start_at);
  const endTimeStr = fmtTime(bk.end_at);
  const clientName = escHtml(bk.client_name || 'Client');

  const serviceHTML = buildServiceDetailHTML(bk, groupServices);

  // Deposit info for cancellation
  let depositHTML = '';
  if (bk.deposit_required && bk.deposit_amount_cents > 0 && bk.deposit_paid_at) {
    const depAmt = fmtPrice(bk.deposit_amount_cents);
    const isRefunded = bk.deposit_status === 'refunded';
    const isRetained = bk.deposit_status === 'cancelled';
    if (isRefunded) {
      depositHTML = `<div style="background:#F0FDF4;border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid #22C55E"><div style="font-size:13px;color:#15803D;font-weight:600">Acompte de ${depAmt} rembours\u00e9 au client</div></div>`;
    } else if (isRetained) {
      depositHTML = `<div style="background:#FEF3E2;border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid #F59E0B"><div style="font-size:13px;color:#92700C;font-weight:600">Acompte de ${depAmt} retenu (annulation tardive)</div></div>`;
    }
  }

  const bodyHTML = `
    <p>Un client a annul\u00e9 son rendez-vous.</p>
    <div style="background:#FEF2F2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #EF4444">
      <div style="font-size:15px;font-weight:600;color:#DC2626;margin-bottom:6px">${dateStr}</div>
      <div style="font-size:14px;color:#DC2626;margin-bottom:8px">${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceHTML}
    </div>
    <div style="background:#F5F4F1;border-radius:8px;padding:12px 16px;margin:12px 0">
      <div style="font-size:13px;color:#6B6560"><strong>Client :</strong> ${clientName}</div>
      ${bk.client_email ? `<div style="font-size:13px;color:#6B6560">${escHtml(bk.client_email)}</div>` : ''}
      ${bk.client_phone ? `<div style="font-size:13px;color:#6B6560">${escHtml(bk.client_phone)}</div>` : ''}
    </div>
    ${depositHTML}
    ${bk.cancel_reason ? `<div style="background:#F5F4F1;border-radius:8px;padding:10px 14px;margin:12px 0"><div style="font-size:13px;color:#6B6560"><strong>Raison :</strong> ${escHtml(bk.cancel_reason)}</div></div>` : ''}
    <p style="font-size:14px;color:#3D3832">Ce cr\u00e9neau est \u00e0 nouveau disponible pour d'autres clients.</p>`;

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const html = buildEmailHTML({
    title: 'Rendez-vous annul\u00e9',
    preheader: `Annulation : ${clientName} \u2014 ${dateStr} \u00e0 ${timeStr}`,
    bodyHTML,
    ctaText: 'Voir dans le dashboard',
    ctaUrl: `${baseUrl}/dashboard`,
    businessName: bk.biz_name,
    primaryColor: color,
    footerText: `${bk.biz_name} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: bk.biz_email,
    toName: bk.biz_name,
    subject: `Annulation \u2014 ${clientName} \u2014 ${fmtDate(bk.start_at)}`,
    html,
    fromName: 'Genda'
  });
}

/**
 * email_reschedule_pro — Notify merchant that a client rescheduled
 */
async function sendRescheduleProEmail(bk, groupServices, metadata) {
  const color = safeColor(bk.biz_theme?.primary_color);
  const dateStr = fmtDate(bk.start_at);
  const timeStr = fmtTime(bk.start_at);
  const endTimeStr = fmtTime(bk.end_at);
  const clientName = escHtml(bk.client_name || 'Client');

  const serviceHTML = buildServiceDetailHTML(bk, groupServices);

  // Show old date from notification metadata (stored at reschedule time)
  let oldDateHTML = '';
  const oldStartAt = metadata?.old_start_at;
  if (oldStartAt) {
    const oldDateStr = fmtDate(oldStartAt);
    const oldTimeStr = fmtTime(oldStartAt);
    oldDateHTML = `
    <div style="background:#FEF3E2;border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid #F59E0B">
      <div style="font-size:13px;color:#92700C"><strong>Ancien cr\u00e9neau :</strong> ${oldDateStr} \u00e0 ${oldTimeStr}</div>
    </div>`;
  }

  // Deposit info
  let depositHTML = '';
  if (bk.deposit_required && bk.deposit_amount_cents > 0) {
    const depAmt = fmtPrice(bk.deposit_amount_cents);
    const isPaid = !!bk.deposit_paid_at;
    depositHTML = `
    <div style="background:${isPaid ? '#F0FDF4' : '#FEF3E2'};border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid ${isPaid ? '#22C55E' : '#F59E0B'}">
      <div style="font-size:13px;color:${isPaid ? '#15803D' : '#92700C'};font-weight:600">Acompte : ${depAmt} ${isPaid ? '(pay\u00e9)' : '(en attente)'}</div>
    </div>`;
  }

  const bodyHTML = `
    <p>Un client a d\u00e9plac\u00e9 son rendez-vous.</p>
    ${oldDateHTML}
    <div style="background:#F0FDF4;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:13px;color:#15803D;font-weight:600;margin-bottom:4px">Nouveau cr\u00e9neau :</div>
      <div style="font-size:15px;font-weight:600;color:#1A1816;margin-bottom:6px">${dateStr}</div>
      <div style="font-size:14px;color:#3D3832;margin-bottom:8px">${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceHTML}
    </div>
    <div style="background:#F5F4F1;border-radius:8px;padding:12px 16px;margin:12px 0">
      <div style="font-size:13px;color:#6B6560"><strong>Client :</strong> ${clientName}</div>
      ${bk.client_email ? `<div style="font-size:13px;color:#6B6560">${escHtml(bk.client_email)}</div>` : ''}
      ${bk.client_phone ? `<div style="font-size:13px;color:#6B6560">${escHtml(bk.client_phone)}</div>` : ''}
    </div>
    ${depositHTML}`;

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const html = buildEmailHTML({
    title: 'Rendez-vous d\u00e9plac\u00e9',
    preheader: `${clientName} a d\u00e9plac\u00e9 son RDV au ${dateStr} \u00e0 ${timeStr}`,
    bodyHTML,
    ctaText: 'Voir dans le dashboard',
    ctaUrl: `${baseUrl}/dashboard`,
    businessName: bk.biz_name,
    primaryColor: color,
    footerText: `${bk.biz_name} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: bk.biz_email,
    toName: bk.biz_name,
    subject: `RDV d\u00e9plac\u00e9 \u2014 ${clientName} \u2014 ${dateStr}`,
    html,
    fromName: 'Genda'
  });
}

/**
 * email_modification_confirmed — Notify merchant that client confirmed the modification
 */
async function sendModificationConfirmedProEmail(bk, groupServices) {
  const color = safeColor(bk.biz_theme?.primary_color);
  const dateStr = fmtDate(bk.start_at);
  const timeStr = fmtTime(bk.start_at);
  const endTimeStr = fmtTime(bk.end_at);
  const clientName = escHtml(bk.client_name || 'Client');

  const serviceHTML = buildServiceDetailHTML(bk, groupServices);

  // Deposit info
  let depositHTML = '';
  if (bk.deposit_required && bk.deposit_amount_cents > 0) {
    const depAmt = fmtPrice(bk.deposit_amount_cents);
    const isPaid = !!bk.deposit_paid_at;
    depositHTML = `
    <div style="background:${isPaid ? '#F0FDF4' : '#FEF3E2'};border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid ${isPaid ? '#22C55E' : '#F59E0B'}">
      <div style="font-size:13px;color:${isPaid ? '#15803D' : '#92700C'};font-weight:600">Acompte : ${depAmt} ${isPaid ? '(pay\u00e9)' : '(en attente)'}</div>
    </div>`;
  }

  const bodyHTML = `
    <p><strong>${clientName}</strong> a confirm\u00e9 la modification de son rendez-vous.</p>
    <div style="background:#F0FDF4;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #22C55E">
      <div style="font-size:15px;font-weight:600;color:#1A1816;margin-bottom:6px">${dateStr}</div>
      <div style="font-size:14px;color:#3D3832;margin-bottom:8px">${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      ${serviceHTML}
    </div>
    <div style="background:#F5F4F1;border-radius:8px;padding:12px 16px;margin:12px 0">
      <div style="font-size:13px;color:#6B6560"><strong>Client :</strong> ${clientName}</div>
      ${bk.client_email ? `<div style="font-size:13px;color:#6B6560">${escHtml(bk.client_email)}</div>` : ''}
      ${bk.client_phone ? `<div style="font-size:13px;color:#6B6560">${escHtml(bk.client_phone)}</div>` : ''}
    </div>
    ${depositHTML}`;

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const html = buildEmailHTML({
    title: 'Modification confirm\u00e9e',
    preheader: `${clientName} a confirm\u00e9 le RDV du ${dateStr}`,
    bodyHTML,
    ctaText: 'Voir dans le dashboard',
    ctaUrl: `${baseUrl}/dashboard`,
    businessName: bk.biz_name,
    primaryColor: color,
    footerText: `${bk.biz_name} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: bk.biz_email,
    toName: bk.biz_name,
    subject: `Modification confirm\u00e9e \u2014 ${clientName} \u2014 ${dateStr}`,
    html,
    fromName: 'Genda'
  });
}

/**
 * email_modification_rejected — Notify merchant that client rejected the modification
 */
async function sendModificationRejectedProEmail(bk, groupServices) {
  const color = safeColor(bk.biz_theme?.primary_color);
  const dateStr = fmtDate(bk.start_at);
  const timeStr = fmtTime(bk.start_at);
  const endTimeStr = fmtTime(bk.end_at);
  const clientName = escHtml(bk.client_name || 'Client');

  const serviceHTML = buildServiceDetailHTML(bk, groupServices);

  // Deposit info
  let depositHTML = '';
  if (bk.deposit_required && bk.deposit_amount_cents > 0) {
    const depAmt = fmtPrice(bk.deposit_amount_cents);
    const isPaid = !!bk.deposit_paid_at;
    const isRefunded = bk.deposit_status === 'refunded';
    if (isRefunded) {
      depositHTML = `<div style="background:#F0FDF4;border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid #22C55E"><div style="font-size:13px;color:#15803D;font-weight:600">Acompte de ${depAmt} rembours\u00e9 au client</div></div>`;
    } else if (isPaid) {
      depositHTML = `
      <div style="background:#F0FDF4;border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid #22C55E">
        <div style="font-size:13px;color:#15803D;font-weight:600">Acompte : ${depAmt} (pay\u00e9)</div>
      </div>`;
    } else {
      depositHTML = `
      <div style="background:#FEF3E2;border-radius:8px;padding:10px 14px;margin:12px 0;border-left:3px solid #F59E0B">
        <div style="font-size:13px;color:#92700C;font-weight:600">Acompte : ${depAmt} (en attente)</div>
      </div>`;
    }
  }

  const bodyHTML = `
    <p><strong>${clientName}</strong> a <span style="color:#DC2626;font-weight:600">refus\u00e9</span> la modification propos\u00e9e.</p>
    <div style="background:#FEF2F2;border-radius:8px;padding:14px 16px;margin:16px 0;border-left:3px solid #EF4444">
      <div style="font-size:14px;color:#DC2626;font-weight:600;margin-bottom:4px">Modification refus\u00e9e</div>
      <div style="font-size:15px;font-weight:600;color:#1A1816;margin-bottom:6px">${dateStr}</div>
      <div style="font-size:14px;color:#3D3832;margin-bottom:8px">${timeStr}${endTimeStr ? ' \u2013 ' + endTimeStr : ''}</div>
      <div style="font-size:13px;color:#3D3832;margin-bottom:8px">Le rendez-vous a \u00e9t\u00e9 annul\u00e9.</div>
      ${serviceHTML}
    </div>
    <div style="background:#F5F4F1;border-radius:8px;padding:12px 16px;margin:12px 0">
      <div style="font-size:13px;color:#6B6560"><strong>Client :</strong> ${clientName}</div>
      ${bk.client_email ? `<div style="font-size:13px;color:#6B6560">${escHtml(bk.client_email)}</div>` : ''}
      ${bk.client_phone ? `<div style="font-size:13px;color:#6B6560">${escHtml(bk.client_phone)}</div>` : ''}
    </div>
    ${depositHTML}
    <p style="font-size:14px;color:#3D3832">Vous pouvez contacter le client pour trouver un autre cr\u00e9neau.</p>`;

  const baseUrl = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';
  const html = buildEmailHTML({
    title: 'Modification refus\u00e9e',
    preheader: `${clientName} a refus\u00e9 la modification`,
    bodyHTML,
    ctaText: 'Voir dans le dashboard',
    ctaUrl: `${baseUrl}/dashboard`,
    businessName: bk.biz_name,
    primaryColor: color,
    footerText: `${bk.biz_name} \u00b7 Via Genda.be`
  });

  return sendEmail({
    to: bk.biz_email,
    toName: bk.biz_name,
    subject: `Modification refus\u00e9e \u2014 ${clientName}`,
    html,
    fromName: 'Genda'
  });
}

// ============================================================
// MAIN PROCESSOR
// ============================================================

/**
 * Process queued pro notifications — called by cron in server.js
 * @returns {{ processed: number, sent: number, failed: number, errors: number }}
 */
async function processNotifications() {
  const stats = { processed: 0, sent: 0, failed: 0, errors: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch queued pro notifications (LIMIT 50 to avoid overload)
    // email_post_rdv uses metadata.delay_until for deferred sending
    const { rows: notifications } = await client.query(
      `SELECT id, business_id, booking_id, type, metadata, created_at
       FROM notifications
       WHERE status = 'queued'
         AND type IN ('email_new_booking_pro', 'email_cancellation_pro', 'email_reschedule_pro', 'email_modification_confirmed', 'email_modification_rejected', 'email_post_rdv')
         AND (metadata->>'delay_until' IS NULL OR (metadata->>'delay_until')::timestamptz <= NOW())
       ORDER BY created_at ASC
       LIMIT 50
       FOR UPDATE SKIP LOCKED`
    );

    if (notifications.length === 0) {
      await client.query('COMMIT');
      return stats;
    }

    for (const notif of notifications) {
      stats.processed++;
      try {
        // Fetch booking data
        const bk = await fetchBookingData(notif.booking_id);
        if (!bk) {
          // Booking deleted — mark as failed
          await client.query(
            `UPDATE notifications SET status = 'failed', error = 'booking_not_found', sent_at = NOW() WHERE id = $1`,
            [notif.id]
          );
          stats.failed++;
          continue;
        }

        // Check if business has an email (not needed for client-facing review emails)
        if (!bk.biz_email && notif.type !== 'email_post_rdv') {
          await client.query(
            `UPDATE notifications SET status = 'failed', error = 'no_business_email', sent_at = NOW() WHERE id = $1`,
            [notif.id]
          );
          stats.failed++;
          continue;
        }

        // Fetch group services for multi-service bookings
        const groupServices = await fetchGroupServices(bk.group_id, bk.business_id);

        // Dispatch to appropriate email builder
        let result;
        switch (notif.type) {
          case 'email_new_booking_pro':
            result = await sendNewBookingProEmail(bk, groupServices);
            break;
          case 'email_cancellation_pro':
            result = await sendCancellationProEmail(bk, groupServices);
            break;
          case 'email_reschedule_pro':
            result = await sendRescheduleProEmail(bk, groupServices, notif.metadata);
            break;
          case 'email_modification_confirmed':
            result = await sendModificationConfirmedProEmail(bk, groupServices);
            break;
          case 'email_modification_rejected':
            result = await sendModificationRejectedProEmail(bk, groupServices);
            break;
          case 'email_post_rdv':
            result = await sendReviewEmail(bk, notif.metadata);
            break;
          default:
            result = { success: false, error: 'unknown_type' };
        }

        if (result.success) {
          await client.query(
            `UPDATE notifications SET status = 'sent', sent_at = NOW(), error = NULL WHERE id = $1`,
            [notif.id]
          );
          stats.sent++;
        } else {
          await client.query(
            `UPDATE notifications SET status = 'failed', error = $2, sent_at = NOW() WHERE id = $1`,
            [notif.id, (result.error || 'unknown_error').substring(0, 500)]
          );
          stats.failed++;
        }
      } catch (err) {
        stats.errors++;
        console.error(`[NOTIF PROCESSOR] Error processing notification ${notif.id}:`, err.message);
        try {
          await client.query(
            `UPDATE notifications SET status = 'failed', error = $2, sent_at = NOW() WHERE id = $1`,
            [notif.id, (err.message || 'exception').substring(0, 500)]
          );
        } catch (_) { /* best-effort status update */ }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[NOTIF PROCESSOR] Fatal error:', err.message);
    stats.errors++;
  } finally {
    client.release();
  }

  return stats;
}

module.exports = { processNotifications };
