/**
 * Cron 1 : retry rows pending toutes les 5 min (backoff exponentiel 1,5,30,120,720 min).
 * Cron 2 : status-check rows peppol_sent coincées > 24h (quotidien).
 *
 * Les deux sont démarrés par server.js au boot si NODE_ENV === 'production'.
 */
const { query } = require('./db');
const peppol = require('./peppol');

const BACKOFF_MINUTES = [1, 5, 30, 120, 720]; // tentatives 1→2→3→4→5 puis fail

async function runRetryPending() {
  const { rows } = await query(
    `SELECT id, stripe_invoice_id, retry_count, ubl_xml, recipient_email
       FROM subscription_invoices
       WHERE status = 'pending' AND next_retry_at <= NOW()
       ORDER BY next_retry_at ASC
       LIMIT 20
       FOR UPDATE SKIP LOCKED`
  );
  for (const row of rows) {
    const emitter = await peppol.loadPlatformSettings();
    const result = await peppol._sendToBillit(row.id, row.ubl_xml, { email: row.recipient_email }, emitter);
    if (result.ok) {
      await query(
        `UPDATE subscription_invoices
           SET billit_invoice_id = $1, status = 'peppol_sent',
               next_retry_at = NULL, updated_at = NOW()
           WHERE id = $2`,
        [result.billitInvoiceId, row.id]
      );
      console.log(`[PEPPOL CRON] retry success for ${row.stripe_invoice_id}`);
    } else {
      const newCount = (row.retry_count || 0) + 1;
      if (newCount >= BACKOFF_MINUTES.length) {
        await query(
          `UPDATE subscription_invoices
             SET status = 'failed', status_detail = $1, next_retry_at = NULL,
                 retry_count = $2, updated_at = NOW()
             WHERE id = $3`,
          [result.reason, newCount, row.id]
        );
        console.error(`[PEPPOL CRON] FAILED after ${newCount} retries: ${row.stripe_invoice_id}`);
      } else {
        const delayMin = BACKOFF_MINUTES[newCount];
        await query(
          `UPDATE subscription_invoices
             SET retry_count = $1, next_retry_at = NOW() + make_interval(mins := $2::int),
                 status_detail = $3, updated_at = NOW()
             WHERE id = $4`,
          [newCount, delayMin, result.reason, row.id]
        );
      }
    }
  }
}

async function runStatusCheckStuck() {
  // Rows peppol_sent qui n'ont pas reçu de callback delivered/bounced en 24h
  const { rows } = await query(
    `SELECT id, billit_invoice_id, stripe_invoice_id
       FROM subscription_invoices
       WHERE status = 'peppol_sent' AND updated_at < NOW() - INTERVAL '24 hours'
       LIMIT 20`
  );
  for (const row of rows) {
    await query(
      `UPDATE subscription_invoices
         SET status = 'failed',
             status_detail = 'No delivery callback within 24h (investigate Billit dashboard)',
             updated_at = NOW()
         WHERE id = $1`,
      [row.id]
    );
    console.warn(`[PEPPOL CRON] stuck > 24h, flagged failed: ${row.stripe_invoice_id}`);
  }
}

function start() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[PEPPOL CRON] skipped (not production)');
    return;
  }
  setInterval(() => {
    runRetryPending().catch(e => console.error('[PEPPOL CRON retry]', e.message));
  }, 5 * 60 * 1000);
  setInterval(() => {
    runStatusCheckStuck().catch(e => console.error('[PEPPOL CRON stuck]', e.message));
  }, 6 * 60 * 60 * 1000);
  console.log('[PEPPOL CRON] started (retry 5min, stuck 6h)');
}

module.exports = { start, runRetryPending, runStatusCheckStuck };
