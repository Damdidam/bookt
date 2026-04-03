# Plan Gating — Free vs Pro

## Context

Genda is a SaaS booking platform for beauty/wellness professionals in Belgium. Currently, almost all features are accessible on the Free plan. Only 3 guards exist (25 bookings/week, 1 practitioner, no SMS). This spec defines the complete gating strategy.

## Business Model

- **Free**: Viable product for solo practitioners. Covers core booking needs.
- **Pro** (60€/month): Unlocks growth tools, advanced features, and integrations.
- Goal: Free creates word-of-mouth and acquisition. Pro monetizes when the business grows or needs advanced tools.

## Free Plan — What's Included

- Calendar + online bookings (max 25/week)
- 1 practitioner
- Email reminders (24h + 2h)
- Minisite on `genda.be/{slug}`
- 1 manual promotion
- Featured slots (créneaux vedettes)
- Client management
- Booking detail, notes, session notes
- Client self-reschedule and self-cancel
- Manual staff booking creation
- Absences and business hours management

## Pro Plan — Additional Features

- Unlimited bookings
- Unlimited practitioners
- SMS reminders (24h + 2h)
- Stripe deposits (request, payment, refund)
- Gift cards (online purchase, balance management, partial payment)
- Passes / subscriptions (online purchase, auto-decrement)
- Unlimited promotions + last-minute auto-discount
- Advanced analytics (revenue, rates, heatmap)
- Intelligent waitlist
- Gap analyzer + smart optimizer
- Calendar sync (Google, Outlook, iCal)
- Invoices / PDF billing
- Custom domain for minisite

## Guards to Implement

### Already Existing (4)
| Feature | Location | Guard |
|---------|----------|-------|
| Bookings 25/week | `public/index.js:148` | Backend: count bookings this week, reject if >= 25 |
| 1 practitioner | `staff/practitioners.js:625` + `frontend/views/team.js:170` | Backend 403 + frontend check |
| SMS reminders | `services/reminders.js:94,324` + `staff/planning.js:984` + `public/booking-actions.js:870,1416` + `public/booking-notifications.js:132,198` | Backend: skip SMS if plan=free |
| Analytics | `staff/dashboard.js:258` | Backend 403 with upgrade_required error |

### New Guards to Add (9)
| Feature | Backend Guard | Frontend Guard |
|---------|--------------|----------------|
| Deposits | Reject deposit creation/request if free | Show deposit settings with Pro badge, disable toggle |
| Gift cards | Reject GC checkout + GC management CRUD if free | Show GC section with Pro badge overlay |
| Passes | Reject pass checkout + pass management CRUD if free | Show passes section with Pro badge overlay |
| Promotions (>1) + LM | Allow 1 promo, block creation of 2nd. Block LM toggle if free | Show LM toggle disabled with Pro badge. Promo create shows "limite atteinte" after 1 |
| Waitlist | Reject waitlist signup + staff waitlist ops if free | Show waitlist nav item with Pro badge, disable |
| Gap analyzer | N/A (frontend-only feature) | Disable button with Pro badge |
| Smart optimizer | N/A (frontend-only feature) | Disable button with Pro badge |
| Calendar sync | Reject Google/Outlook connect if free | Show cal-sync section with Pro badge overlay |
| Invoices | Reject invoice creation if free | Show invoices nav item with Pro badge |
| Custom domain | Reject domain connect if free | Show domain field disabled with Pro badge |

## UX Pattern for Gated Features

Features are NOT hidden from Free users. They are visible but locked:

1. **Navigation**: Menu items for Pro features show a small "Pro" badge next to the label
2. **Feature sections**: Content is visible but covered with a semi-transparent overlay containing:
   - Lock icon
   - "Disponible avec le plan Pro"
   - "Passer au Pro →" button (links to settings subscription section)
3. **Inline toggles** (e.g., LM, deposit, SMS): Toggle is disabled, label shows "Plan Pro requis"
4. **Backend responses**: Return `{ error: 'upgrade_required', message: 'Cette fonctionnalité est disponible avec le plan Pro.' }` with HTTP 403

## Implementation Approach

### Backend: Centralized plan guard middleware

Create a reusable `requirePro` middleware in `middleware/auth.js`:
```js
function requirePro(req, res, next) {
  if (req.businessPlan === 'free') {
    return res.status(403).json({ 
      error: 'upgrade_required', 
      message: 'Cette fonctionnalité est disponible avec le plan Pro.' 
    });
  }
  next();
}
```

Apply to route groups:
- `router.use(requirePro)` for fully gated routers (waitlist staff, invoices, cal-sync)
- `requirePro` on specific endpoints for partially gated routers (deposits, GC, passes, promos)

### Frontend: Centralized plan gate utility

Create a `planGate(feature)` utility in `frontend/utils/plan-gate.js`:
- Checks `window._businessPlan`
- Returns `true` if allowed, `false` if gated
- Provides `showProGate(containerEl)` to render the overlay
- Provides `proBadgeHtml()` for nav item badges

### Promotion special case

The promo guard is count-based, not binary:
- Backend: In POST `/api/promotions`, count existing active promos. If free and count >= 1, reject.
- Backend: In PATCH `/api/settings` for `last_minute_enabled`, reject if free.
- Frontend: Disable "Nouvelle promotion" button if free and 1 already exists. Disable LM toggle.

## Files to Modify

### Backend (middleware + routes)
- `src/middleware/auth.js` — add `requirePro`
- `src/routes/staff/deposits.js` — add guard
- `src/routes/staff/invoices.js` — add guard
- `src/routes/staff/waitlist.js` — add guard
- `src/routes/staff/calendar.js` — add guard
- `src/routes/staff/promotions.js` — add count guard + LM guard
- `src/routes/staff/settings.js` — add guard on deposit/LM/domain settings
- `src/routes/staff/site.js` — add guard on custom domain
- `src/routes/public/gift-cards-passes.js` — add guard on GC/pass checkout
- `src/routes/public/deposit.js` — add guard on deposit payment page
- `src/routes/public/waitlist.js` — add guard on waitlist signup

### Frontend (UI gates)
- `src/frontend/utils/plan-gate.js` — new utility
- `src/frontend/router.js` — add Pro badges to nav items
- `src/frontend/views/invoices.js` — add gate overlay
- `src/frontend/views/waitlist.js` — add gate overlay
- `src/frontend/views/gift-cards.js` — add gate overlay
- `src/frontend/views/passes.js` — add gate overlay
- `src/frontend/views/deposits.js` — add gate overlay
- `src/frontend/views/cal-sync.js` — add gate overlay
- `src/frontend/views/promotions.js` — add count gate + LM gate
- `src/frontend/views/settings.js` — disable deposit/LM/domain toggles
- `src/frontend/views/agenda/gap-analyzer.js` — add gate
- `src/frontend/views/agenda/smart-optimizer.js` — add gate
- `src/frontend/views/site.js` — disable custom domain field

### Public-facing (booking flow)
- `src/routes/public/index.js` — deposit guard already exists via shouldRequireDeposit (checks Stripe Connect), needs plan check too
- `public/book.html` — hide deposit/GC/pass payment options if business is free
- `public/site.html` — hide waitlist signup if business is free
