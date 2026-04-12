# Mode "Sur devis" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Sur devis" (quote-only) mode to services so clients submit a project request with images instead of booking directly.

**Architecture:** A `quote_only` boolean on the `services` table gates the booking flow. Quote-only services show a request form on `book.html` instead of time selection. Submissions are stored in `quote_requests` + `quote_request_images` tables and emailed to the business owner. Image uploads reuse the existing base64 → disk pattern from gallery.

**Tech Stack:** PostgreSQL, Express.js, Brevo email API, vanilla JS frontend, Vite build

---

### Task 1: Database migration

**Files:**
- Create: `schema-v35-quote-requests.sql`

- [ ] **Step 1: Write the migration SQL file**

```sql
-- ============================================================
-- GENDA v35 — Quote Requests (Sur devis)
-- Add quote_only flag to services + quote request tables
-- ============================================================

-- 1. Add quote_only flag to services
ALTER TABLE services ADD COLUMN IF NOT EXISTS quote_only BOOLEAN DEFAULT false;

-- 2. Quote requests table
CREATE TABLE IF NOT EXISTS quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  service_name VARCHAR(200),
  client_name VARCHAR(200) NOT NULL,
  client_email VARCHAR(200) NOT NULL,
  client_phone VARCHAR(30),
  description TEXT NOT NULL,
  body_zone VARCHAR(100),
  approx_size VARCHAR(100),
  status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'treated')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quote_requests_business ON quote_requests(business_id, created_at DESC);

-- 3. Quote request images
CREATE TABLE IF NOT EXISTS quote_request_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_request_id UUID NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  original_filename VARCHAR(255),
  size_bytes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quote_images_request ON quote_request_images(quote_request_id);
```

- [ ] **Step 2: Run the migration on the Render database**

```bash
psql "$DATABASE_URL" -f schema-v35-quote-requests.sql
```

Expected: `ALTER TABLE`, `CREATE TABLE`, `CREATE INDEX` — no errors.

- [ ] **Step 3: Verify the column and tables exist**

```bash
psql "$DATABASE_URL" -c "\d services" | grep quote_only
psql "$DATABASE_URL" -c "\d quote_requests"
```

Expected: `quote_only | boolean | default false` and full table description.

- [ ] **Step 4: Commit**

```bash
git add schema-v35-quote-requests.sql
git commit -m "feat(db): add quote_only flag + quote_requests tables (v35)"
```

---

### Task 2: Backend — service CRUD accepts `quote_only`

**Files:**
- Modify: `src/routes/staff/services.js` (POST ~line 58, PATCH ~line 193)

- [ ] **Step 1: Add `quote_only` to POST /api/services**

In `src/routes/staff/services.js`, in the POST handler (~line 58), add `quote_only` to the destructuring:

```javascript
const { name, category, duration_min, buffer_before_min, buffer_after_min,
        price_cents, price_label, mode_options, prep_instructions_fr,
        prep_instructions_nl, color, description, available_schedule, practitioner_ids, variants,
        bookable_online, processing_time, processing_start,
        flexibility_enabled, flexibility_discount_pct, promo_eligible,
        min_booking_notice_hours, quote_only } = req.body;
```

Then add the column to the INSERT query (~line 86-91). Add `quote_only` as the last column:

Change the INSERT to include `quote_only` as column 22:

```sql
INSERT INTO services (business_id, name, category, duration_min,
  buffer_before_min, buffer_after_min, price_cents, price_label,
  mode_options, prep_instructions_fr, prep_instructions_nl, color, description, available_schedule, bookable_online,
  processing_time, processing_start, flexibility_enabled, flexibility_discount_pct, promo_eligible,
  min_booking_notice_hours, quote_only)
 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
 RETURNING *
```

Add the value `!!quote_only` as the last parameter in the array (~line 104):

```javascript
         parseInt(min_booking_notice_hours) || 0,
         !!quote_only]
```

- [ ] **Step 2: Add `quote_only` to the PATCH allowed list**

In the PATCH handler (~line 193), add `'quote_only'` to the `allowed` array:

```javascript
const allowed = ['name', 'category', 'duration_min', 'buffer_before_min',
  'buffer_after_min', 'price_cents', 'price_label', 'mode_options',
  'prep_instructions_fr', 'prep_instructions_nl', 'is_active', 'color', 'sort_order', 'description', 'available_schedule', 'bookable_online',
  'processing_time', 'processing_start',
  'flexibility_enabled', 'flexibility_discount_pct', 'promo_eligible',
  'min_booking_notice_hours', 'quote_only'];
```

- [ ] **Step 3: Test with curl**

```bash
# Create a quote-only service
curl -s -X POST http://localhost:3000/api/services \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Tatouage custom","duration_min":120,"quote_only":true}' | jq .

# Verify quote_only is true in response
# Then update it
curl -s -X PATCH http://localhost:3000/api/services/$SVC_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"quote_only":false}' | jq .quote_only
```

Expected: `true` then `false`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/staff/services.js
git commit -m "feat: service CRUD accepts quote_only flag"
```

---

### Task 3: Backend — public minisite API returns `quote_only`

**Files:**
- Modify: `src/routes/public/minisite.js` (~line 120-127, ~line 345-364)

- [ ] **Step 1: Add `quote_only` to the services SELECT**

In `src/routes/public/minisite.js` (~line 120), add `quote_only` to the SELECT:

```sql
SELECT id, name, category, duration_min, price_cents, price_label,
        mode_options, prep_instructions_fr, prep_instructions_nl, color, description, bookable_online,
        processing_time, processing_start,
        flexibility_enabled, flexibility_discount_pct, available_schedule, min_booking_notice_hours,
        promo_eligible, quote_only
 FROM services
 WHERE business_id = $1 AND is_active = true
 ORDER BY sort_order, name
```

- [ ] **Step 2: Add `quote_only` to the response mapping**

In the service response mapping (~line 345), add `quote_only`:

```javascript
services: svcResult.rows.map(s => ({
    id: s.id,
    name: s.name,
    // ... existing fields ...
    available_schedule: s.available_schedule || null,
    quote_only: !!s.quote_only,
    variants: (varByService[s.id] || []).map(v => ({
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/public/minisite.js
git commit -m "feat: public API returns quote_only for services"
```

---

### Task 4: Backend — quote request endpoint + email

**Files:**
- Create: `src/routes/public/quote-request.js`
- Modify: `src/routes/public/index.js` (~line 24, add sub-router mount)

- [ ] **Step 1: Create the quote request route file**

Create `src/routes/public/quote-request.js`:

```javascript
const router = require('express').Router();
const { query } = require('../../services/db');
const { bookingLimiter } = require('../../middleware/rate-limiter');
const { sendEmail, buildEmailHTML, escHtml } = require('../../services/email-utils');
const fs = require('fs');
const path = require('path');
const { checkQuota } = require('../../services/storage-quota');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE_URL = process.env.APP_BASE_URL || process.env.BASE_URL || 'https://genda.be';

// POST /api/public/:slug/quote-request
router.post('/:slug/quote-request', bookingLimiter, async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { service_id, client_name, client_email, client_phone,
            description, body_zone, approx_size, images } = req.body;

    // --- Validate business ---
    const bizResult = await query(
      `SELECT b.id, b.name, b.email, b.phone, b.sector, b.settings
       FROM businesses b WHERE b.slug = $1 AND b.is_active = true`,
      [slug]
    );
    if (bizResult.rows.length === 0) return res.status(404).json({ error: 'Business introuvable' });
    const biz = bizResult.rows[0];
    const bid = biz.id;

    // --- Validate service ---
    if (!service_id || !UUID_RE.test(service_id)) return res.status(400).json({ error: 'service_id requis' });
    const svcResult = await query(
      `SELECT id, name, quote_only FROM services WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [service_id, bid]
    );
    if (svcResult.rows.length === 0) return res.status(404).json({ error: 'Prestation introuvable' });
    if (!svcResult.rows[0].quote_only) return res.status(400).json({ error: 'Cette prestation ne nécessite pas de devis' });
    const serviceName = svcResult.rows[0].name;

    // --- Validate required fields ---
    if (!client_name || !client_name.trim()) return res.status(400).json({ error: 'Nom requis' });
    if (!client_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email)) return res.status(400).json({ error: 'Email invalide' });
    if (!description || !description.trim()) return res.status(400).json({ error: 'Description du projet requise' });
    if (description.length > 2000) return res.status(400).json({ error: 'Description trop longue (max 2000 caractères)' });

    // --- Process images (base64, max 3, max 5MB each) ---
    const imageEntries = [];
    if (Array.isArray(images) && images.length > 0) {
      if (images.length > 3) return res.status(400).json({ error: 'Maximum 3 images' });

      const uploadDir = path.join(__dirname, '../../../public/uploads/quotes');
      fs.mkdirSync(uploadDir, { recursive: true });

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const match = img.data.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
        if (!match) return res.status(400).json({ error: `Image ${i + 1}: format invalide (JPEG, PNG ou WebP)` });

        const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: `Image ${i + 1}: trop lourde (max 5 Mo)` });

        // Check storage quota
        const quota = await checkQuota(bid, buffer.length, query);
        if (!quota.allowed) return res.status(413).json({ error: quota.message });

        const filename = `${bid}_${Date.now()}_${i}.${ext}`;
        fs.writeFileSync(path.join(uploadDir, filename), buffer);
        const imageUrl = `/uploads/quotes/${filename}`;

        imageEntries.push({
          url: imageUrl,
          originalFilename: img.name || `image_${i + 1}.${ext}`,
          sizeBytes: buffer.length
        });
      }
    }

    // --- Insert quote request ---
    const qrResult = await query(
      `INSERT INTO quote_requests (business_id, service_id, service_name, client_name, client_email, client_phone, description, body_zone, approx_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [bid, service_id, serviceName, client_name.trim(), client_email.trim().toLowerCase(),
       client_phone?.trim() || null, description.trim(),
       body_zone?.trim() || null, approx_size?.trim() || null]
    );
    const qrId = qrResult.rows[0].id;

    // --- Insert images ---
    for (const img of imageEntries) {
      await query(
        `INSERT INTO quote_request_images (quote_request_id, image_url, original_filename, size_bytes)
         VALUES ($1, $2, $3, $4)`,
        [qrId, img.url, img.originalFilename, img.sizeBytes]
      );
    }

    // --- Email to business owner ---
    const ownerEmail = biz.email || (await query(`SELECT email FROM users WHERE business_id = $1 AND role = 'owner' LIMIT 1`, [bid])).rows[0]?.email;
    if (ownerEmail) {
      let bodyHTML = `<p><strong>Prestation :</strong> ${escHtml(serviceName)}</p>`;
      bodyHTML += `<p><strong>Client :</strong> ${escHtml(client_name)}</p>`;
      bodyHTML += `<p><strong>Email :</strong> <a href="mailto:${escHtml(client_email)}">${escHtml(client_email)}</a></p>`;
      if (client_phone) bodyHTML += `<p><strong>Téléphone :</strong> <a href="tel:${escHtml(client_phone)}">${escHtml(client_phone)}</a></p>`;
      if (body_zone) bodyHTML += `<p><strong>Zone du corps :</strong> ${escHtml(body_zone)}</p>`;
      if (approx_size) bodyHTML += `<p><strong>Taille approximative :</strong> ${escHtml(approx_size)}</p>`;
      bodyHTML += `<p><strong>Description du projet :</strong></p><p>${escHtml(description).replace(/\n/g, '<br>')}</p>`;

      if (imageEntries.length > 0) {
        bodyHTML += `<p><strong>Images de référence (${imageEntries.length}) :</strong></p>`;
        for (const img of imageEntries) {
          const fullUrl = `${BASE_URL}${img.url}`;
          bodyHTML += `<p><a href="${fullUrl}">${escHtml(img.originalFilename)}</a></p>`;
        }
      }

      const html = buildEmailHTML({
        title: 'Nouvelle demande de devis',
        preheader: `${client_name} souhaite un devis pour ${serviceName}`,
        bodyHTML,
        ctaText: 'Répondre par email',
        ctaUrl: `mailto:${client_email}?subject=${encodeURIComponent('Devis — ' + serviceName)}`,
        businessName: biz.name,
        primaryColor: biz.settings?.theme_color || '#6C5CE7'
      });

      await sendEmail({
        to: ownerEmail,
        subject: `Nouvelle demande de devis — ${serviceName}`,
        html,
        replyTo: client_email
      });
    }

    // --- Confirmation email to client ---
    const clientBodyHTML = `<p>Votre demande de devis pour <strong>${escHtml(serviceName)}</strong> a bien été envoyée.</p>`
      + `<p>${escHtml(biz.name)} vous recontactera pour discuter de votre projet et vous proposer un devis.</p>`
      + (biz.phone ? `<p>Vous pouvez aussi les contacter au <a href="tel:${escHtml(biz.phone)}">${escHtml(biz.phone)}</a>.</p>` : '');

    const clientHtml = buildEmailHTML({
      title: 'Demande de devis envoyée',
      preheader: `Votre demande pour ${serviceName} a été reçue`,
      bodyHTML: clientBodyHTML,
      businessName: biz.name,
      primaryColor: biz.settings?.theme_color || '#6C5CE7'
    });

    await sendEmail({
      to: client_email,
      subject: `Votre demande de devis — ${biz.name}`,
      html: clientHtml,
      fromName: biz.name
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
```

- [ ] **Step 2: Mount the router in the public index**

In `src/routes/public/index.js`, add after line 24 (`require('./booking-actions')`):

```javascript
router.use('/', require('./quote-request'));
```

- [ ] **Step 3: Test with curl**

```bash
curl -s -X POST http://localhost:3000/api/public/jay-one/quote-request \
  -H "Content-Type: application/json" \
  -d '{
    "service_id": "<ID_OF_QUOTE_ONLY_SERVICE>",
    "client_name": "Test Client",
    "client_email": "test@example.com",
    "description": "Je voudrais un tatouage géométrique sur l avant-bras, environ 15cm",
    "body_zone": "avant-bras",
    "approx_size": "10-20cm",
    "images": []
  }' | jq .
```

Expected: `{ "success": true }`.

- [ ] **Step 4: Commit**

```bash
git add src/routes/public/quote-request.js src/routes/public/index.js
git commit -m "feat: POST /api/public/:slug/quote-request endpoint + emails"
```

---

### Task 5: Dashboard — toggle "Sur devis" in service form

**Files:**
- Modify: `src/frontend/views/services.js` (service form + list rendering)

- [ ] **Step 1: Find the service form and add the toggle**

In `src/frontend/views/services.js`, find the service edit modal form. Locate the line with `svc_dur` input (duration field, ~line 645). Just BEFORE the duration/price row, add the toggle:

```javascript
m += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 14px;background:var(--surface);border-radius:var(--radius-xs)">
  <label class="svc-toggle"><input type="checkbox" id="svc_quote_only" ${svc?.quote_only ? 'checked' : ''}><span class="svc-toggle-slider"></span></label>
  <div><div style="font-size:.85rem;font-weight:600">Sur devis</div><div style="font-size:.72rem;color:var(--text-4)">Le client envoie une demande au lieu de réserver directement</div></div>
</div>`;
```

- [ ] **Step 2: Add `quote_only` to the save payload**

Find the save function where `body` is constructed (search for `svc_dur` value reading, ~line 897). Add:

```javascript
body.quote_only = !!document.getElementById('svc_quote_only')?.checked;
```

- [ ] **Step 3: Auto-fill price_label when quote_only is checked**

Add an onchange handler for the toggle. After the modal HTML is injected (after `openModal` or similar), add:

```javascript
const qoEl = document.getElementById('svc_quote_only');
if (qoEl) qoEl.addEventListener('change', function() {
  const plabelEl = document.getElementById('svc_plabel');
  if (this.checked && plabelEl && !plabelEl.value.trim()) {
    plabelEl.value = 'Sur devis';
  }
});
```

- [ ] **Step 4: Add badge in service list**

Find where service rows are rendered in the list. After the service name, add a badge if `quote_only`:

```javascript
if (s.quote_only) h += '<span style="display:inline-block;font-size:.65rem;font-weight:700;background:var(--primary-bg);color:var(--primary);padding:1px 6px;border-radius:4px;margin-left:6px;vertical-align:middle">Sur devis</span>';
```

- [ ] **Step 5: Test in browser**

1. Open dashboard → Prestations
2. Edit a service → check "Sur devis" → save
3. Verify badge appears in list
4. Re-open the service → verify toggle is still checked

- [ ] **Step 6: Commit**

```bash
git add src/frontend/views/services.js
git commit -m "feat: quote_only toggle in service form + badge in list"
```

---

### Task 6: Booking page — quote request form for `quote_only` services

**Files:**
- Modify: `public/book.html` (buildSkRow function ~line 973, new form step, submit logic)

- [ ] **Step 1: Modify `buildSkRow` to show "Sur devis" badge and different button**

In `public/book.html`, in the `buildSkRow` function (~line 973), after the price display and before the closing `</div>` of `sk-svc-info`, add the quote badge. Also change the button for quote-only services:

Replace the existing button line (~line 998):
```javascript
if(!noBook) h+='<button class="sk-svc-btn" data-id="'+s.id+'">S\u00e9lectionner</button>';
```

With:
```javascript
if(!noBook){
  if(s.quote_only){
    h+='<button class="sk-svc-btn sk-quote-btn" data-id="'+s.id+'" data-quote="1">Demander un devis</button>';
  } else {
    h+='<button class="sk-svc-btn" data-id="'+s.id+'">S\u00e9lectionner</button>';
  }
}
```

And in the price display, when `quote_only` is true and no price, show "Sur devis":
After line 990 (`h+='<div class="sk-svc-price">'+svcDisplayPrice(s)+'</div>';`), wrap it:

```javascript
if(s.quote_only && !s.price_cents){
  h+='<div class="sk-svc-price" style="color:var(--primary);font-weight:600">Sur devis</div>';
} else {
  h+='<div class="sk-svc-price">'+svcDisplayPrice(s)+'</div>';
}
```

- [ ] **Step 2: Add the quote request form step HTML**

After the step 4 div (client info step), add a new hidden step for quote requests:

```html
<!-- STEP: QUOTE REQUEST -->
<div class="step" data-step="quote" id="stepQuote" style="display:none">
  <h2 class="step-title">Demande de devis</h2>
  <p class="step-sub" id="quoteSub">Décrivez votre projet, nous vous recontacterons avec un devis.</p>
  <div id="quoteServiceName" style="font-weight:700;margin-bottom:16px"></div>
  <div class="fg"><label class="fl">Nom *</label><input class="fi" id="qName" placeholder="Votre nom"></div>
  <div class="fg"><label class="fl">Email *</label><input class="fi" id="qEmail" type="email" placeholder="votre@email.com"></div>
  <div class="fg"><label class="fl">Téléphone</label><input class="fi" id="qPhone" type="tel" placeholder="+32..."></div>
  <div class="fg"><label class="fl">Description du projet *</label><textarea class="fi ft" id="qDesc" maxlength="2000" rows="5" placeholder="Décrivez votre projet en détail..."></textarea></div>
  <div id="quoteTattooFields" style="display:none">
    <div class="fg"><label class="fl">Zone du corps</label>
      <select class="fi" id="qBodyZone">
        <option value="">— Sélectionnez —</option>
        <option>Bras</option><option>Avant-bras</option><option>Épaule</option>
        <option>Dos</option><option>Torse</option><option>Jambe</option>
        <option>Cheville</option><option>Poignet</option><option>Cou</option>
        <option>Main</option><option>Autre</option>
      </select>
    </div>
    <div class="fg"><label class="fl">Taille approximative</label>
      <select class="fi" id="qApproxSize">
        <option value="">— Sélectionnez —</option>
        <option>< 5cm</option><option>5-10cm</option><option>10-20cm</option>
        <option>20-30cm</option><option>30cm+</option>
        <option>Manchette</option><option>Dos complet</option>
      </select>
    </div>
  </div>
  <div class="fg"><label class="fl">Images de référence <span class="opt">(max 3, 5 Mo chacune)</span></label>
    <input type="file" id="qImages" accept="image/jpeg,image/png,image/webp" multiple style="font-size:.85rem">
  </div>
  <div id="quoteImagePreviews" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>
  <button class="btn-next" id="btnQuoteSubmit">Envoyer ma demande</button>
  <button class="btn-outline" id="backQuote">← Retour</button>
</div>
```

- [ ] **Step 3: Wire the quote button click in `wireSkButtons`**

In the `wireSkButtons` function (~line 1010), modify the click handler to detect quote services:

```javascript
container.querySelectorAll('.sk-svc-btn').forEach(btn=>{
  btn.addEventListener('click',function(e){
    e.stopPropagation();
    const svc=siteData.services.find(x=>x.id===btn.dataset.id);
    if(!svc)return;
    if(svc.quote_only){
      openQuoteForm(svc);
      return;
    }
    if(svc.variants&&svc.variants.length>0){
      showVariantModal(svc,function(variant){
        const vi=svc.variants.findIndex(v=>v.id===variant.id);
        selectVariant(svc.id,vi>=0?vi:0);
        if(!multiServiceMode) goNext();
      });
    }else{
      selectService(svc.id);
      if(!multiServiceMode) goNext();
    }
  });
});
```

- [ ] **Step 4: Add the `openQuoteForm` function and submit logic**

Add this JavaScript in the main script section (after the step navigation functions):

```javascript
var _quoteServiceId = null;

function openQuoteForm(svc) {
  _quoteServiceId = svc.id;
  // Hide all steps, show quote step
  document.querySelectorAll('.step').forEach(s => s.style.display = 'none');
  var qs = document.getElementById('stepQuote');
  qs.style.display = '';
  document.getElementById('quoteServiceName').textContent = svc.name;

  // Sector-specific placeholder
  var sector = siteData.business.sector || 'autre';
  var placeholders = {
    tatouage: 'Décrivez votre projet : style souhaité, éléments, signification...',
    photographe: 'Décrivez votre projet : type d\'événement, lieu, nombre de personnes...',
    esthetique: 'Décrivez ce que vous recherchez : occasion, style souhaité...'
  };
  document.getElementById('qDesc').placeholder = placeholders[sector] || 'Décrivez votre projet en détail...';

  // Show tattoo-specific fields
  document.getElementById('quoteTattooFields').style.display = sector === 'tatouage' ? '' : 'none';

  // Image preview
  var imgInput = document.getElementById('qImages');
  imgInput.value = '';
  document.getElementById('quoteImagePreviews').innerHTML = '';
  imgInput.onchange = function() {
    var previews = document.getElementById('quoteImagePreviews');
    previews.innerHTML = '';
    if (this.files.length > 3) {
      alert('Maximum 3 images');
      this.value = '';
      return;
    }
    for (var i = 0; i < this.files.length; i++) {
      if (this.files[i].size > 5 * 1024 * 1024) {
        alert('Image ' + (i+1) + ' trop lourde (max 5 Mo)');
        this.value = '';
        previews.innerHTML = '';
        return;
      }
      var img = document.createElement('img');
      img.src = URL.createObjectURL(this.files[i]);
      img.style.cssText = 'width:70px;height:70px;object-fit:cover;border-radius:8px;border:1.5px solid var(--border)';
      previews.appendChild(img);
    }
  };
}

document.getElementById('backQuote').addEventListener('click', function() {
  document.getElementById('stepQuote').style.display = 'none';
  document.querySelectorAll('.step[data-step="1"]').forEach(s => s.style.display = '');
});

document.getElementById('btnQuoteSubmit').addEventListener('click', async function() {
  var name = document.getElementById('qName').value.trim();
  var email = document.getElementById('qEmail').value.trim();
  var desc = document.getElementById('qDesc').value.trim();
  if (!name) return alert('Veuillez entrer votre nom');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert('Email invalide');
  if (!desc) return alert('Veuillez décrire votre projet');

  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Envoi en cours...';

  try {
    // Convert images to base64
    var imgFiles = document.getElementById('qImages').files;
    var images = [];
    for (var i = 0; i < imgFiles.length; i++) {
      var b64 = await fileToBase64(imgFiles[i]);
      images.push({ data: b64, name: imgFiles[i].name });
    }

    var body = {
      service_id: _quoteServiceId,
      client_name: name,
      client_email: email,
      client_phone: document.getElementById('qPhone').value.trim() || null,
      description: desc,
      body_zone: document.getElementById('qBodyZone')?.value || null,
      approx_size: document.getElementById('qApproxSize')?.value || null,
      images: images
    };

    var r = await fetch('/api/public/' + siteData.business.slug + '/quote-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      var err = await r.json().catch(function() { return {}; });
      throw new Error(err.error || 'Erreur');
    }

    // Show success
    document.getElementById('stepQuote').innerHTML = '<div style="text-align:center;padding:40px 20px">'
      + '<div style="font-size:2.5rem;margin-bottom:16px">✓</div>'
      + '<h2 style="margin-bottom:8px">Demande envoyée !</h2>'
      + '<p style="color:var(--text-3)">' + escH(siteData.business.name) + ' vous recontactera pour discuter de votre projet et vous proposer un devis.</p>'
      + '</div>';
  } catch (e) {
    alert('Erreur : ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Envoyer ma demande';
  }
});

function fileToBase64(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

- [ ] **Step 5: Add CSS for the quote button**

In the `<style>` section of `book.html`, add:

```css
.sk-quote-btn{background:var(--primary-bg)!important;color:var(--primary)!important;border:1.5px solid var(--primary-border)!important}
.sk-quote-btn:hover{background:var(--primary)!important;color:#fff!important}
```

- [ ] **Step 6: Test in browser**

1. Go to the booking page of a business with a quote-only service
2. Verify the service shows "Sur devis" and "Demander un devis" button
3. Click it → verify the quote form appears with correct fields
4. For a tatouage-sector business, verify body zone + size fields appear
5. Submit with valid data → verify success message
6. Check the owner received the email

- [ ] **Step 7: Commit**

```bash
git add public/book.html
git commit -m "feat: quote request form in booking page for quote_only services"
```

---

### Task 7: Build, push, deploy

**Files:**
- No new files

- [ ] **Step 1: Build frontend**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Commit dist and push**

```bash
git add -f dist/
git commit -m "build: dist"
git push
```

- [ ] **Step 3: Trigger Render deploy**

Manually trigger deploy on Render dashboard or wait for auto-deploy.

- [ ] **Step 4: Verify in production**

1. Open a tattoo business booking page
2. Verify quote-only service shows correctly
3. Submit a test quote request
4. Verify emails arrive (to owner + confirmation to client)
