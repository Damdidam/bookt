require('dotenv').config({ path: '.env.test' });
const fs = require('fs');
const path = require('path');
const { pool } = require('../../src/services/db');
const IDS = require('./fixtures/ids');

const C = { RESET: '\x1b[0m', GREEN: '\x1b[32m', RED: '\x1b[31m', YELLOW: '\x1b[33m', BOLD: '\x1b[1m', DIM: '\x1b[2m', CYAN: '\x1b[36m' };

async function cleanup(runStart) {
  if (!runStart) { console.warn('[TEARDOWN] No runStart, skipping cleanup'); return; }

  const bid = IDS.BUSINESS;
  if (!bid || bid.length !== 36) throw new Error('TEST_BUSINESS_ID invalid');
  const check = await pool.query(`SELECT is_test_account FROM businesses WHERE id = $1`, [bid]);
  if (!check.rows[0]?.is_test_account) {
    throw new Error(`ABORT: business ${bid} is NOT a test account — cleanup aborted`);
  }

  await pool.query('BEGIN');
  try {
    // Ordre enfants → parents (FK-safe)
    await pool.query(`DELETE FROM gift_card_transactions WHERE business_id = $1 AND created_at >= $2
      AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`, [bid, runStart]);
    await pool.query(`DELETE FROM pass_transactions WHERE business_id = $1 AND created_at >= $2
      AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`, [bid, runStart]);
    await pool.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1 AND created_at >= $2)`, [bid, runStart]);
    await pool.query(`DELETE FROM invoices WHERE business_id = $1 AND created_at >= $2
      AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`, [bid, runStart]);
    await pool.query(`DELETE FROM notifications WHERE business_id = $1 AND created_at >= $2`, [bid, runStart]);
    await pool.query(`DELETE FROM bookings WHERE business_id = $1 AND created_at >= $2
      AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`, [bid, runStart]);
    await pool.query(`DELETE FROM waitlist_entries WHERE business_id = $1 AND created_at >= $2
      AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`, [bid, runStart]);
    await pool.query(`DELETE FROM gift_cards WHERE business_id = $1 AND created_at >= $2
      AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`, [bid, runStart]);
    await pool.query(`DELETE FROM passes WHERE business_id = $1 AND created_at >= $2
      AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_id IS NOT NULL)`, [bid, runStart]);
    await pool.query(`DELETE FROM audit_logs WHERE business_id = $1 AND created_at >= $2`, [bid, runStart]);
    await pool.query(`DELETE FROM clients WHERE business_id = $1 AND created_at >= $2
      AND id NOT IN (SELECT entity_id FROM seed_tracking WHERE entity_type = 'client')`, [bid, runStart]);
    await pool.query(`DELETE FROM test_mock_log WHERE created_at >= $1`, [runStart]);

    await pool.query('COMMIT');
    console.log(`${C.DIM}[TEARDOWN] Cleanup OK (runStart=${runStart})${C.RESET}`);
  } catch (e) {
    await pool.query('ROLLBACK');
    console.error(`${C.RED}[TEARDOWN] Cleanup failed: ${e.message}${C.RESET}`);
    throw e;
  }
}

function printSummary() {
  const reportPath = path.join(__dirname, 'playwright-report', 'results.json');
  if (!fs.existsSync(reportPath)) {
    console.log(`${C.YELLOW}[TEARDOWN] No report found, skipping summary${C.RESET}`);
    return;
  }
  let report;
  try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (e) {
    console.warn('[TEARDOWN] results.json parse error:', e.message); return;
  }
  const stats = report.stats || {};
  const { expected = 0, unexpected = 0, skipped = 0, flaky = 0, duration = 0 } = stats;
  const total = expected + unexpected + skipped + flaky;

  const byCategory = {};
  function walk(suite, fileName = '') {
    if (suite.file) fileName = suite.file;
    const catMatch = fileName.match(/C(\d+)-[^/]+/) || ['smoke'];
    const cat = catMatch[0];
    byCategory[cat] ??= { passed: 0, failed: 0, skipped: 0, fails: [], duration: 0 };
    for (const spec of (suite.specs || [])) {
      for (const t of (spec.tests || [])) {
        const res = t.results?.[0];
        if (!res) continue;
        byCategory[cat].duration += res.duration || 0;
        if (res.status === 'passed') byCategory[cat].passed++;
        else if (res.status === 'failed' || res.status === 'timedOut') {
          byCategory[cat].failed++;
          byCategory[cat].fails.push({ title: spec.title, error: (res.error?.message || 'no msg').slice(0, 100) });
        } else if (res.status === 'skipped') byCategory[cat].skipped++;
      }
    }
    for (const sub of (suite.suites || [])) walk(sub, fileName);
  }
  for (const s of (report.suites || [])) walk(s);

  const bar = '═'.repeat(69);
  const line = '━'.repeat(25);
  console.log(`\n${C.BOLD}╔${bar}╗`);
  console.log(`║  GENDA E2E — ${new Date().toLocaleString('fr-BE')}${' '.repeat(Math.max(0, 50 - new Date().toLocaleString('fr-BE').length))}║`);
  console.log(`╚${bar}╝${C.RESET}\n`);

  const successRate = total > 0 ? ((expected / total) * 100).toFixed(1) : '0';
  const statusColor = unexpected > 0 ? C.RED : (skipped > 0 ? C.YELLOW : C.GREEN);
  console.log(`  ${statusColor}${C.BOLD}${expected}/${total} passed  (${successRate}%)${C.RESET}`);
  if (unexpected > 0) console.log(`  ${C.RED}✗ ${unexpected} failed${C.RESET}`);
  if (skipped > 0) console.log(`  ${C.DIM}⊘ ${skipped} skipped${C.RESET}`);
  if (flaky > 0) console.log(`  ${C.YELLOW}⚠ ${flaky} flaky${C.RESET}`);

  console.log(`\n${C.CYAN}${line} Par catégorie ${line}${C.RESET}`);
  const cats = Object.keys(byCategory).sort();
  for (const cat of cats) {
    const c = byCategory[cat];
    const catTotal = c.passed + c.failed + c.skipped;
    const icon = c.failed > 0 ? `${C.RED}✗${C.RESET}` : `${C.GREEN}✓${C.RESET}`;
    const pct = catTotal > 0 ? Math.round((c.passed / catTotal) * 100) : 0;
    const secs = (c.duration / 1000).toFixed(1);
    console.log(`  ${icon} ${cat.padEnd(36)} ${c.passed}/${catTotal}  ${String(pct).padStart(3)}%  ${secs}s`);
    for (const f of c.fails) {
      console.log(`      ${C.RED}✗${C.RESET} ${f.title.slice(0, 50).padEnd(50)}  ${C.DIM}${f.error}${C.RESET}`);
    }
  }

  const totalSec = (duration / 1000).toFixed(0);
  console.log(`\n${C.BOLD}Temps total: ${Math.floor(totalSec / 60)}min ${totalSec % 60}s${C.RESET}`);
  console.log(`\n${C.DIM}HTML report    : npm run test:e2e:report`);
  console.log(`Re-run fails   : npm run test:e2e:last-failed${C.RESET}\n`);
}

module.exports = async () => {
  console.log('\n[GLOBAL TEARDOWN] Starting...');
  let runStart;
  try { runStart = fs.readFileSync(path.join(__dirname, '.run-start-ts'), 'utf8').trim(); } catch (e) {}

  try {
    await cleanup(runStart);
  } catch (e) {
    console.error(`[TEARDOWN] Cleanup error: ${e.message}`);
  }

  printSummary();

  try { fs.unlinkSync(path.join(__dirname, '.run-start-ts')); } catch (e) {}

  await pool.end();
};
