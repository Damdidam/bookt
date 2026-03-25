# Invoice-Booking Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-populate invoice line items from completed bookings, with pass deduction lines and a "Facturer" toast after completing a booking.

**Architecture:** Add `GET /api/invoices/unbilled` endpoint, add `booking_id` column to `invoice_items`, enrich the invoice modal frontend with a booking checkbox section that auto-fills line items, and add a "Facturer" action to the completed-status toast.

**Tech Stack:** Node.js/Express backend, PostgreSQL, vanilla JS frontend (same as existing codebase)

**Spec:** `docs/superpowers/specs/2026-03-25-invoice-booking-link-design.md`

---

### Task 1: Schema migration — add booking_id to invoice_items

**Files:**
- Create: `schema-v61-invoice-item-booking.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- schema-v61-invoice-item-booking.sql
-- Link invoice line items to source bookings for unbilled detection

ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_booking ON invoice_items(booking_id) WHERE booking_id IS NOT NULL;
```

- [ ] **Step 2: Run migration on prod**

```bash
psql "$DATABASE_URL" -f schema-v61-invoice-item-booking.sql
```

- [ ] **Step 3: Add auto-migrate to server.js**

In `src/server.js`, add after existing auto-migrate block:

```javascript
// Auto-migrate: invoice_items.booking_id
try {
  await pool.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_invoice_items_booking ON invoice_items(booking_id) WHERE booking_id IS NOT NULL`);
} catch (e) {}
```

- [ ] **Step 4: Commit**

```bash
git add schema-v61-invoice-item-booking.sql src/server.js
git commit -m "feat: add booking_id column to invoice_items for booking-invoice link"
```

---

### Task 2: Backend — GET /api/invoices/unbilled endpoint

**Files:**
- Modify: `src/routes/staff/invoices.js`

- [ ] **Step 1: Add the unbilled endpoint**

Add BEFORE the `POST /` route (around line 55) in `src/routes/staff/invoices.js`:

```javascript
// ============================================================
// GET /api/invoices/unbilled — completed bookings without invoice (last 7 days)
// ============================================================
router.get('/unbilled', async (req, res, next) => {
  try {
    const bid = req.businessId;
    const { client_id } = req.query;
    if (!client_id) return res.status(400).json({ error: 'client_id requis' });

    const result = await queryWithRLS(bid,
      `SELECT b.id, b.start_at, b.group_id, b.deposit_payment_intent_id, b.deposit_amount_cents,
              s.name AS service_name, s.price_cents AS service_price_cents,
              sv.name AS variant_name, sv.price_cents AS variant_price_cents,
              p.display_name AS practitioner_name
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       LEFT JOIN service_variants sv ON sv.id = b.service_variant_id
       LEFT JOIN practitioners p ON p.id = b.practitioner_id
       WHERE b.business_id = $1
         AND b.client_id = $2
         AND b.status = 'completed'
         AND b.start_at >= NOW() - INTERVAL '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM invoice_items ii
           JOIN invoices inv ON inv.id = ii.invoice_id
           WHERE ii.booking_id = b.id AND inv.status != 'cancelled'
         )
       ORDER BY b.start_at DESC`,
      [bid, client_id]
    );

    res.json({ bookings: result.rows });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Verify route order**

The `/unbilled` route MUST be declared BEFORE `/:id/pdf` and `/:id/status` routes, otherwise Express will treat "unbilled" as an `:id` parameter.

- [ ] **Step 3: Commit**

```bash
git add src/routes/staff/invoices.js
git commit -m "feat: add GET /api/invoices/unbilled endpoint for completed bookings"
```

---

### Task 3: Backend — store booking_id on invoice_items during creation

**Files:**
- Modify: `src/routes/staff/invoices.js` — POST `/` route

- [ ] **Step 1: Accept booking_ids array in POST body**

In the destructuring (line 61), add `booking_ids`:

```javascript
const { booking_id, booking_ids, client_id, type, items, notes, vat_rate,
        due_days, language, client_address, client_bce } = req.body;
```

- [ ] **Step 2: Pass booking_id through to invoice_items INSERT**

Each item in `invoiceItems` can now carry a `booking_id` field. Modify the INSERT loop (line 171-178):

```javascript
for (const [i, item] of invoiceItems.entries()) {
  await txClient.query(
    `INSERT INTO invoice_items (invoice_id, booking_id, description, quantity, unit_price_cents, vat_rate, total_cents, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [invoiceId, item.booking_id || null, item.description, item.quantity || 1,
     item.unit_price_cents || 0, (item.vat_rate !== undefined && item.vat_rate !== null) ? parseFloat(item.vat_rate) : vatR,
     item.total_cents || 0, i]
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/staff/invoices.js
git commit -m "feat: store booking_id on invoice_items during creation"
```

---

### Task 4: Frontend — unbilled bookings section in invoice modal

**Files:**
- Modify: `src/frontend/views/invoices.js`

- [ ] **Step 1: Add client onchange handler to fetch unbilled bookings**

In `openInvoiceModal()`, change the client select to trigger a fetch:

Replace the `<select>` for client (line 124-127) with:
```html
<select class="m-input" id="invClient" onchange="invClientChanged()">
```

- [ ] **Step 2: Add the unbilled section HTML placeholder**

After the client `</div>` block and before the VAT row, add:

```html
<div id="invUnbilledSection" style="display:none">
  <label class="m-field-label">RDV non facturés (7 derniers jours)</label>
  <div id="invUnbilledList" style="border:1px solid var(--border-light);border-radius:var(--radius-xs);overflow:hidden;max-height:200px;overflow-y:auto"></div>
</div>
```

- [ ] **Step 3: Implement invClientChanged() function**

```javascript
let _unbilledBookings = [];

async function invClientChanged() {
  const clientId = document.getElementById('invClient')?.value;
  const section = document.getElementById('invUnbilledSection');
  const list = document.getElementById('invUnbilledList');
  if (!clientId || !section || !list) { if (section) section.style.display = 'none'; return; }

  try {
    const data = await api.get(`/api/invoices/unbilled?client_id=${clientId}`);
    _unbilledBookings = data.bookings || [];
  } catch (e) { _unbilledBookings = []; }

  if (_unbilledBookings.length === 0) { section.style.display = 'none'; return; }

  section.style.display = '';
  list.innerHTML = _unbilledBookings.map((b, i) => {
    const dt = new Date(b.start_at).toLocaleDateString('fr-BE');
    const price = b.variant_price_cents ?? b.service_price_cents ?? 0;
    const label = b.service_name + (b.variant_name ? ' — ' + b.variant_name : '') +
      ' (' + (b.practitioner_name || '?') + ') — ' + dt;
    return `<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:.82rem;cursor:pointer;border-bottom:1px solid var(--border-light);background:${i%2===0?'var(--white)':'var(--surface)'}">
      <input type="checkbox" data-unbilled-idx="${i}" onchange="invToggleUnbilled(${i},this.checked)">
      <span style="flex:1">${esc(label)}</span>
      <span style="font-weight:600;color:var(--text-2)">${fmtEur(price)}</span>
    </label>`;
  }).join('');
}
```

- [ ] **Step 4: Implement invToggleUnbilled() function**

```javascript
function invToggleUnbilled(idx, checked) {
  const b = _unbilledBookings[idx];
  if (!b) return;
  const container = document.getElementById('invLines');
  if (!container) return;

  if (checked) {
    // Add service line
    const dt = new Date(b.start_at).toLocaleDateString('fr-BE');
    const desc = b.service_name + (b.variant_name ? ' — ' + b.variant_name : '') +
      ' (' + (b.practitioner_name || '') + ') — ' + dt;
    const price = b.variant_price_cents ?? b.service_price_cents ?? 0;
    _addInvoiceLineFromBooking(b.id, desc, 1, price / 100);

    // Add pass deduction line if applicable
    if (b.deposit_payment_intent_id && b.deposit_payment_intent_id.startsWith('pass_') && b.deposit_amount_cents) {
      const passCode = b.deposit_payment_intent_id.replace('pass_', '');
      _addInvoiceLineFromBooking(b.id, 'Pass ' + passCode + ' (déduction)', 1, -(b.deposit_amount_cents / 100));
    }
  } else {
    // Remove lines for this booking
    container.querySelectorAll(`[data-booking-id="${b.id}"]`).forEach(r => r.remove());
  }
  updateInvTotals();
}

function _addInvoiceLineFromBooking(bookingId, desc, qty, priceEur) {
  const container = document.getElementById('invLines');
  if (!container) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px';
  row.setAttribute('data-booking-id', bookingId);
  row.innerHTML = `
    <input class="inv-desc" value="${esc(desc)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="${qty}" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" value="${priceEur.toFixed(2)}" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  container.appendChild(row);
}
```

- [ ] **Step 5: Update saveInvoice() to include booking_id on items**

In `saveInvoice()`, modify the items collection (line 214-218):

```javascript
container.querySelectorAll(':scope > div').forEach(row => {
  const desc = row.querySelector('.inv-desc')?.value?.trim();
  const qty = parseFloat(row.querySelector('.inv-qty')?.value || 1);
  const price = parseFloat(row.querySelector('.inv-price')?.value || 0);
  const bookingId = row.getAttribute('data-booking-id') || undefined;
  if (desc && price !== 0) items.push({
    description: desc, quantity: qty,
    unit_price_cents: Math.round(price * 100),
    booking_id: bookingId
  });
});
```

Note: `price !== 0` instead of `price > 0` to allow negative deduction lines.

- [ ] **Step 6: Register new functions in bridge()**

Add to the bridge() call at the bottom:
```javascript
bridge({ ..., invClientChanged, invToggleUnbilled });
```

- [ ] **Step 7: Commit**

```bash
npm run build && git add -f dist/ src/frontend/views/invoices.js
git commit -m "feat: auto-populate invoice lines from unbilled bookings with pass deductions"
```

---

### Task 5: Frontend — "Facturer" toast after completing a booking

**Files:**
- Modify: `src/frontend/views/agenda/booking-status.js`

- [ ] **Step 1: Add Facturer action to completed toast**

In `fcSetStatus()` (around line 31-36), replace the `else` block for completed status:

```javascript
} else if (newStatus === 'completed') {
  const bookingId = calState.fcCurrentEventId;
  const clientId = calState.fcCurrentBooking?.client_id;
  const groupId = calState.fcCurrentBooking?.group_id;
  gToast('Statut mis à jour', 'success', [
    { label: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Facturer', fn: () => openInvoiceForBooking(bookingId, clientId, groupId) }
  ], 12000);
```

- [ ] **Step 2: Implement openInvoiceForBooking()**

Add in `booking-status.js`:

```javascript
async function openInvoiceForBooking(bookingId, clientId, groupId) {
  // Navigate to invoices section
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  document.querySelector('[data-section="invoices"]')?.classList.add('active');
  document.getElementById('pageTitle').textContent = 'Facturation';

  // Import and open modal
  const mod = await import('../invoices.js');
  mod.openInvoiceModal('invoice', { preselect_client_id: clientId, precheck_booking_id: bookingId, precheck_group_id: groupId });
}
```

- [ ] **Step 3: Update openInvoiceModal() to accept prefill options**

In `invoices.js`, modify the function signature:

```javascript
async function openInvoiceModal(type = 'invoice', prefill = {}) {
```

After the modal is appended to DOM and after `addInvoiceLine()`:

```javascript
// Pre-select client if provided
if (prefill.preselect_client_id) {
  const sel = document.getElementById('invClient');
  if (sel) { sel.value = prefill.preselect_client_id; }
  // Trigger fetch unbilled + auto-check bookings
  await invClientChanged();
  if (prefill.precheck_booking_id || prefill.precheck_group_id) {
    setTimeout(() => {
      _unbilledBookings.forEach((b, i) => {
        const shouldCheck = (prefill.precheck_booking_id && b.id === prefill.precheck_booking_id)
          || (prefill.precheck_group_id && b.group_id === prefill.precheck_group_id);
        if (shouldCheck) {
          const cb = document.querySelector(`[data-unbilled-idx="${i}"]`);
          if (cb && !cb.checked) { cb.checked = true; invToggleUnbilled(i, true); }
        }
      });
    }, 100);
  }
}
```

- [ ] **Step 4: Export openInvoiceForBooking from bridge**

In `booking-status.js`:
```javascript
bridge({ ..., openInvoiceForBooking });
```

- [ ] **Step 5: Build and commit**

```bash
npm run build && git add -f dist/ src/frontend/views/invoices.js src/frontend/views/agenda/booking-status.js
git commit -m "feat: add Facturer toast button after booking completed + pre-fill modal"
```

---

### Task 6: Build, push, deploy

**Files:**
- All modified files

- [ ] **Step 1: Final build**

```bash
cd /Users/Hakim/Desktop/bookt && npm run build
```

- [ ] **Step 2: Push**

```bash
git push
```

- [ ] **Step 3: Run migration on prod**

```bash
psql "postgresql://gendadb_user:iermg01ZdfxZxK241DCPldZDde7Wo4Az@dpg-d6shagvafjfc73evlo1g-a.frankfurt-postgres.render.com/gendadb" -f schema-v61-invoice-item-booking.sql
```

- [ ] **Step 4: Deploy**

```bash
render deploys create srv-d6et4a3h46gs73df0kp0 --confirm
```

- [ ] **Step 5: Verify**

1. Open dashboard → Facturation → Nouvelle facture
2. Select a client with completed bookings in last 7 days
3. Verify unbilled bookings appear as checkboxes
4. Check a booking → verify line item auto-fills with correct description + price
5. If pass was used → verify deduction line appears
6. Edit a line → verify totals update
7. Uncheck → verify lines removed
8. Save → verify invoice created with booking_id on items
9. Re-open modal for same client → verify that booking no longer appears (already invoiced)
10. Mark a booking as completed → verify "Facturer" button in toast → verify it opens pre-filled modal
