# Invoice-Booking Link — Design Spec

## Summary
Enhance the invoicing system to auto-populate invoice line items from completed bookings, with full editability before validation.

## Flows

### Flow 1: Modal "Nouvelle facture"
1. User selects a client from the dropdown
2. Frontend fetches unbilled completed bookings (last 7 days) via `GET /api/invoices/unbilled?client_id=X`
3. Unbilled bookings appear as **checkboxes** between the client selector and the line items section
4. Each booking in a group = 1 separate checkbox (multi-service groups expand)
5. Checking a booking auto-adds a pre-filled line item:
   - **Description**: `{service_name} — {variant_name} ({practitioner_name}) — {date DD/MM/YYYY}`
   - Variant omitted if null
   - **Quantity**: 1
   - **Price**: variant `price_cents` or service `price_cents`
6. If a pass covered the booking (`deposit_payment_intent_id` starts with `pass_`), an additional deduction line is added:
   - **Description**: `Pass {code} (déduction)`
   - **Price**: negative amount (= deposit_amount_cents negated)
7. Unchecking removes the auto-generated lines
8. All auto-generated lines are fully editable (description, qty, price, delete)
9. Manual free-text lines can still be added via "+ Ajouter une ligne"
10. Live totals update on every change (subtotal, TVA, total TTC)

### Flow 2: Toast after "completed"
1. When a booking status changes to `completed`, the success toast shows a **"Facturer"** button
2. Clicking it opens the invoice modal with:
   - Client pre-selected (from booking)
   - That booking's checkbox pre-checked and line items pre-filled
3. For grouped bookings, all group members are pre-checked

## Backend Changes

### New endpoint: `GET /api/invoices/unbilled`
- **Auth**: requireAuth + requireRole('owner', 'manager')
- **Query params**: `client_id` (required)
- **Returns**: bookings where:
  - `status = 'completed'`
  - `start_at >= NOW() - 7 days`
  - No invoice exists with matching `booking_id`
  - Business scoped via RLS
- **Joins**: services (name, price_cents, category), service_variants (name, price_cents), practitioners (display_name)
- **Response**: `{ bookings: [...] }` with fields: id, start_at, service_name, variant_name, practitioner_name, price_cents, group_id, deposit_payment_intent_id, deposit_amount_cents

### Modify: `POST /api/invoices`
- Accept optional `booking_ids: UUID[]` (array) instead of single `booking_id`
- For each booking_id, store the link: set `booking_id` on the corresponding `invoice_item`
- Keep backward compatibility with single `booking_id`

### Schema change: `invoice_items`
- Add column: `booking_id UUID REFERENCES bookings(id)` (nullable)
- Purpose: trace which line item came from which booking (for unbilled detection)

## Frontend Changes

### `invoices.js` — `openInvoiceModal()`
1. After client selection (`onchange`), fetch `GET /api/invoices/unbilled?client_id=X`
2. Render checkbox list in a new section between client selector and line items:
   ```
   ── RDV non facturés (7 derniers jours) ──
   ☑ Épilation sourcils — Courts (Véronique) — 25/03/2026  |  40,00 €
   ☐ Maquillage permanent (Ashley) — 25/03/2026             | 250,00 €
   ```
3. Each checkbox `onchange`:
   - Checked → append line item row (pre-filled, editable) + pass deduction line if applicable
   - Unchecked → remove the auto-generated line(s) for that booking
4. Track which line items are auto-generated via `data-booking-id` attribute on the row

### `booking-status.js` — completed toast
1. After status change to `completed`, add action button to toast:
   ```js
   { label: IC.receipt + ' Facturer', fn: () => openInvoiceForBooking(bookingId) }
   ```
2. `openInvoiceForBooking(bookingId)`:
   - Fetch booking details (client_id, group_id)
   - Navigate to invoices section
   - Open modal with client pre-selected
   - Pre-check the booking (and group siblings if grouped)

## Pass Deduction Logic
- Detect pass usage: `booking.deposit_payment_intent_id?.startsWith('pass_')`
- Extract pass code: `deposit_payment_intent_id.replace('pass_', '')`
- Deduction amount: `booking.deposit_amount_cents` (negated)
- Line description: `Pass {code} (déduction)`
- Deduction line is also editable/deletable

## What Doesn't Change
- PDF generation (reads invoice_items as-is)
- Status lifecycle (draft → sent → paid)
- Belgian compliance (TVA, structured communication, BCE)
- Manual line items (free-text)
- VAT rate selector
- Notes field
- Existing single-booking `createInvoiceFromBooking()` still works
