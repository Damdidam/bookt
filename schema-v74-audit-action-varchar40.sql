-- v74: Widen audit_logs.action VARCHAR(20) → VARCHAR(40)
--
-- BUG CRITIQUE découvert par l'audit 20 avril : plusieurs action strings dépassent 20 chars,
-- ce qui fait échouer silencieusement l'INSERT audit_log et rollback la transaction parente :
--   - 'stripe_external_refund'    (22 chars) → casse la cascade charge.refunded Stripe Dashboard
--   - 'pdf_download_impersonated' (25 chars) → casse l'audit download PDF facture impersonated
--   - 'gift_card_reactivated'     (21 chars) → casse l'audit de réactivation de GC
--
-- Les 3 INSERT sont dans une tx (ou wrapper try/catch) qui fait rollback → fonction business cassée.
-- Le cascade `charge.refunded` n'avait jamais fonctionné en prod !
--
-- VARCHAR(40) = ~2x la longueur du plus long existant, marge pour futurs usages.

ALTER TABLE audit_logs ALTER COLUMN action TYPE VARCHAR(40);
