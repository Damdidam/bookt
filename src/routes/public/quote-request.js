/**
 * Public quote request endpoint
 * POST /api/public/:slug/quote-request
 */
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { query } = require('../../services/db');
const { bookingLimiter } = require('../../middleware/rate-limiter');
const { UUID_RE, escHtml, BASE_URL } = require('./helpers');
const { sendEmail, buildEmailHTML } = require('../../services/email-utils');

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_DESCRIPTION_CHARS = 2000;

router.post('/:slug/quote-request', bookingLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const {
      service_id, client_name, client_email, client_phone,
      description, body_zone, approx_size, images,
      booking_start_at, booking_end_at, practitioner_name, booking_token
    } = req.body;

    // ── Validate business ──
    const bizRes = await query(
      `SELECT id, name, email, phone, settings FROM businesses WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    if (bizRes.rows.length === 0) {
      return res.status(404).json({ error: 'Business introuvable' });
    }
    const biz = bizRes.rows[0];

    // ── Validate service ──
    if (!service_id || !UUID_RE.test(service_id)) {
      return res.status(400).json({ error: 'service_id invalide' });
    }
    const svcRes = await query(
      `SELECT id, name, quote_only FROM services WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [service_id, biz.id]
    );
    if (svcRes.rows.length === 0) {
      return res.status(404).json({ error: 'Service introuvable' });
    }
    const svc = svcRes.rows[0];
    if (!svc.quote_only) {
      return res.status(400).json({ error: 'Ce service ne fonctionne pas sur devis' });
    }

    // ── Validate required fields ──
    if (!client_name || !client_name.trim()) {
      return res.status(400).json({ error: 'Nom requis' });
    }
    if (!client_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email)) {
      return res.status(400).json({ error: 'Email invalide' });
    }
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Description requise' });
    }
    if (description.length > MAX_DESCRIPTION_CHARS) {
      return res.status(400).json({ error: `Description trop longue (max ${MAX_DESCRIPTION_CHARS} caractères)` });
    }

    // ── Insert quote request ──
    const qrRes = await query(
      `INSERT INTO quote_requests (business_id, service_id, service_name, client_name, client_email, client_phone, description, body_zone, approx_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, created_at`,
      [biz.id, svc.id, svc.name, client_name.trim(), client_email.trim().toLowerCase(), client_phone?.trim() || null, description.trim(), body_zone?.trim() || null, approx_size?.trim() || null]
    );
    const quoteRequest = qrRes.rows[0];

    // ── Process images (base64 → disk) ──
    const savedImages = [];
    if (Array.isArray(images) && images.length > 0) {
      const toProcess = images.slice(0, MAX_IMAGES);
      const { ensureSubdir } = require('../../services/uploads');
      const uploadDir = ensureSubdir('quotes');

      for (let i = 0; i < toProcess.length; i++) {
        const img = toProcess[i];
        // Accept both raw base64 strings and {data, name} objects
        const raw = typeof img === 'string' ? img : img?.data;
        const origName = typeof img === 'object' ? img?.name : null;
        const match = raw?.match(/^data:image\/(jpeg|jpg|png|webp|gif|heic|heif|avif);base64,(.+)$/);
        if (!match) continue;

        const ext = match[1] === 'jpg' ? 'jpeg' : match[1] === 'heif' ? 'heic' : match[1];
        const buffer = Buffer.from(match[2], 'base64');

        if (buffer.length > MAX_IMAGE_BYTES) continue;

        const filename = `${quoteRequest.id}-${i}.${ext}`;
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) continue;

        fs.writeFileSync(path.join(uploadDir, filename), buffer);
        const imageUrl = `/uploads/quotes/${filename}`;

        await query(
          `INSERT INTO quote_request_images (quote_request_id, image_url, original_filename, size_bytes)
           VALUES ($1, $2, $3, $4)`,
          [quoteRequest.id, imageUrl, origName || `image_${i + 1}.${ext}`, buffer.length]
        );
        savedImages.push(imageUrl);
      }
    }

    // ── Find owner email ──
    let ownerEmail = biz.email;
    if (!ownerEmail) {
      const ownerRes = await query(
        `SELECT email FROM users WHERE business_id = $1 AND role = 'owner' LIMIT 1`,
        [biz.id]
      );
      if (ownerRes.rows.length > 0) ownerEmail = ownerRes.rows[0].email;
    }

    const primaryColor = biz.settings?.primary_color || '#0D7377';

    // ── Email to business owner ──
    if (ownerEmail) {
      let bookingDateHTML = '';
      if (booking_start_at) {
        const _pd = new Date(booking_start_at);
        const _pdStr = _pd.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
        const _ptStr = _pd.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
        bookingDateHTML = `<tr><td style="padding:8px 12px;font-weight:600;color:#666">Créneau</td><td style="padding:8px 12px"><strong>${escHtml(_pdStr)} à ${escHtml(_ptStr)}</strong>${practitioner_name ? ' avec ' + escHtml(practitioner_name) : ''}</td></tr>`;
      }

      let bodyHTML = `
        <p>Vous avez reçu une nouvelle demande de devis.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px 12px;font-weight:600;color:#666;width:140px">Service</td><td style="padding:8px 12px">${escHtml(svc.name)}</td></tr>
          ${bookingDateHTML}
          <tr style="background:#F9F9F8"><td style="padding:8px 12px;font-weight:600;color:#666">Client</td><td style="padding:8px 12px">${escHtml(client_name)}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;color:#666">Email</td><td style="padding:8px 12px"><a href="mailto:${escHtml(client_email)}">${escHtml(client_email)}</a></td></tr>`;

      if (client_phone) {
        bodyHTML += `<tr style="background:#F9F9F8"><td style="padding:8px 12px;font-weight:600;color:#666">Téléphone</td><td style="padding:8px 12px">${escHtml(client_phone)}</td></tr>`;
      }
      if (body_zone) {
        bodyHTML += `<tr><td style="padding:8px 12px;font-weight:600;color:#666">Zone du corps</td><td style="padding:8px 12px">${escHtml(body_zone)}</td></tr>`;
      }
      if (approx_size) {
        bodyHTML += `<tr style="background:#F9F9F8"><td style="padding:8px 12px;font-weight:600;color:#666">Taille approximative</td><td style="padding:8px 12px">${escHtml(approx_size)}</td></tr>`;
      }

      bodyHTML += `</table>`;
      bodyHTML += `<p style="font-weight:600;margin-top:16px">Description :</p>`;
      bodyHTML += `<div style="background:#F9F9F8;padding:12px 16px;border-radius:8px;border-left:3px solid ${escHtml(primaryColor)};margin:8px 0;white-space:pre-wrap">${escHtml(description)}</div>`;

      if (savedImages.length > 0) {
        bodyHTML += `<p style="font-weight:600;margin-top:16px">Photos jointes (${savedImages.length}) :</p>`;
        bodyHTML += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">`;
        for (const imgUrl of savedImages) {
          const absUrl = BASE_URL + imgUrl;
          bodyHTML += `<a href="${escHtml(absUrl)}" target="_blank"><img src="${escHtml(absUrl)}" style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid #eee" alt="Photo jointe"></a>`;
        }
        bodyHTML += `</div>`;
      }

      const ownerHtml = buildEmailHTML({
        title: 'Nouvelle demande de devis',
        // H7 fix: preheader escaped inside buildEmailHTML — pass raw
        preheader: `${client_name} — ${svc.name}`,
        bodyHTML,
        ctaText: 'Répondre au client',
        ctaUrl: `mailto:${client_email}?subject=${encodeURIComponent('Votre demande de devis — ' + svc.name)}`,
        businessName: biz.name,
        primaryColor
      });

      await sendEmail({
        to: ownerEmail,
        toName: biz.name,
        subject: `Demande de devis — ${svc.name} — ${client_name}`,
        html: ownerHtml,
        replyTo: client_email
      });
    }

    // ── Confirmation email to client ──
    let bookingInfoHTML = '';
    if (booking_start_at) {
      const _d = new Date(booking_start_at);
      const _dateStr = _d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' });
      const _timeStr = _d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
      let _endStr = '';
      if (booking_end_at) {
        _endStr = ' — ' + new Date(booking_end_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
      }
      bookingInfoHTML = `<table style="width:100%;border-collapse:collapse;margin:12px 0">
        <tr><td style="padding:6px 12px;font-weight:600;color:#666;width:100px">Date</td><td style="padding:6px 12px">${escHtml(_dateStr)}</td></tr>
        <tr style="background:#F9F9F8"><td style="padding:6px 12px;font-weight:600;color:#666">Heure</td><td style="padding:6px 12px">${escHtml(_timeStr)}${escHtml(_endStr)}</td></tr>
        ${practitioner_name ? `<tr><td style="padding:6px 12px;font-weight:600;color:#666">Avec</td><td style="padding:6px 12px">${escHtml(practitioner_name)}</td></tr>` : ''}
      </table>`;
    }

    const manageUrl = booking_token ? `${BASE_URL}/booking/${booking_token}` : null;

    const clientBodyHTML = `
      <p>Bonjour ${escHtml(client_name)},</p>
      <p>Votre demande de devis pour <strong>${escHtml(svc.name)}</strong> a bien été envoyée à <strong>${escHtml(biz.name)}</strong>.</p>
      ${bookingInfoHTML}
      <p>Vous recevrez une réponse par email dans les meilleurs délais avec le prix et les détails de paiement.</p>
      ${biz.phone ? `<p>Vous pouvez aussi les contacter au <a href="tel:${escHtml(biz.phone)}">${escHtml(biz.phone)}</a>.</p>` : ''}
      <p style="margin-top:20px;font-size:13px;color:#888">Récapitulatif de votre projet :</p>
      <div style="background:#F9F9F8;padding:12px 16px;border-radius:8px;margin:8px 0;white-space:pre-wrap;font-size:14px;color:#555">${escHtml(description)}</div>`;

    const clientHtml = buildEmailHTML({
      title: 'Demande de devis envoyée',
      preheader: `Votre demande pour ${svc.name} a été transmise`,
      bodyHTML: clientBodyHTML,
      ctaText: manageUrl ? 'Gérer mon rendez-vous' : undefined,
      ctaUrl: manageUrl || undefined,
      businessName: biz.name,
      primaryColor
    });

    await sendEmail({
      to: client_email,
      toName: client_name,
      subject: `Votre demande de devis — ${biz.name}`,
      html: clientHtml
    });

    // ── Response ──
    res.status(201).json({
      id: quoteRequest.id,
      created_at: quoteRequest.created_at,
      images_saved: savedImages.length
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
