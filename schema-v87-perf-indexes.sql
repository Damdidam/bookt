-- schema-v87 : Perf indexes scan 3 (PERF-03/04/05)
--
-- Scan 3 A6 a identifié 3 queries hot-path sans index couvrant :
--
-- PERF-03 : gift_card_transactions(booking_id, type='debit')
--   Utilisée par dashboard analytics (staff/dashboard.js:97,323,371,421),
--   invoices.js:84, deposits.js:28,144, public/deposit.js:66,261.
--   Pattern : WHERE booking_id = $1 AND type = 'debit' → scan séquentiel
--   sur 10k+ transactions.
--
-- PERF-04 : notifications suppression-list check (email-utils.js:126)
--   À chaque envoi d'email, check 7 ILIKE sur `error` + filter recipient
--   + date. Actuellement seul idx_notifs_business existe → scan séquentiel
--   sur 10k+ rows. Pour 100 emails/min en peak, DB saturée.
--
-- PERF-05 : notifications queue processor (notification-processor.js:577)
--   WHERE status='queued' AND (next_retry_at IS NULL OR next_retry_at <= NOW())
--   L'index idx_notifs_queued existe mais ne couvre pas next_retry_at →
--   scan du subset queued à chaque tick 30s.
--
-- CREATE INDEX CONCURRENTLY évite de locker les tables en prod.

-- PERF-03 : gift_card_transactions(booking_id) partial index WHERE type='debit'
-- (debit est le cas hot pour dashboard/deposits ; refund/purchase peu querried)
CREATE INDEX IF NOT EXISTS idx_gct_booking_debit
  ON gift_card_transactions(booking_id)
  WHERE type = 'debit';

-- PERF-04 : notifications suppression-list check (lookup rapide par email + error present)
-- Partial index pour ignorer les rows sans erreur (majorité des notifs sent=OK).
CREATE INDEX IF NOT EXISTS idx_notif_supp_list
  ON notifications(business_id, LOWER(recipient_email))
  WHERE error IS NOT NULL AND type LIKE 'email_%';

-- PERF-05 : notifications queue + retry backoff
-- Couvre le WHERE status='queued' AND next_retry_at IS NULL OR <= NOW()
CREATE INDEX IF NOT EXISTS idx_notif_retry
  ON notifications(next_retry_at, created_at)
  WHERE status = 'queued';

-- PERF-bonus : pass_transactions(booking_id) partial index WHERE type='debit'
-- même usage que PERF-03 pour les passes (dashboard, bookings-status, deposit-expiry)
CREATE INDEX IF NOT EXISTS idx_ptx_booking_debit
  ON pass_transactions(booking_id)
  WHERE type = 'debit';
