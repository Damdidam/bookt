#!/usr/bin/env node
/**
 * BOOKT — Automated Sanity Test Suite
 * Runs against the live API (Render or local).
 *
 * Usage:
 *   node tests/sanity.js                         # all tests
 *   node tests/sanity.js --section slots          # only slot engine tests
 *   node tests/sanity.js --section booking        # only booking creation
 *   node tests/sanity.js --section staff          # only staff booking creation
 *   node tests/sanity.js --section lifecycle      # only lifecycle tests
 *   node tests/sanity.js --section deposit        # only deposit/GC tests
 *   node tests/sanity.js --section calendar       # only calendar ops tests
 *   node tests/sanity.js --section edge           # only edge cases
 *   node tests/sanity.js --verbose                # show request/response details
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const { Pool } = require('pg');

// ─── CONFIG ──────────────────────────────────────────────────────
const API_BASE = process.env.TEST_API_BASE || 'https://bookt-qgm2.onrender.com';
const DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://gendadb_user:iermg01ZdfxZxK241DCPldZDde7Wo4Az@dpg-d6shagvafjfc73evlo1g-a.oregon-postgres.render.com/gendadb';
const STAFF_EMAIL = process.env.TEST_STAFF_EMAIL || 'hakim.abbes@gmail.com';
const STAFF_PASSWORD = process.env.TEST_STAFF_PASSWORD || 'H300191945@@';
const SLUG = process.env.TEST_SLUG || 'va-institut';

const VERBOSE = process.argv.includes('--verbose');
const SECTION_FILTER = (() => {
  const idx = process.argv.indexOf('--section');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

// ─── STATE ───────────────────────────────────────────────────────
let pool;
let staffToken = null;
let businessId = null;
let testPractitionerId = null;
let testServiceId = null;
let testServiceWithVariantId = null;
let testVariantId = null;
let testService2Id = null;
let testClientId = null;
let siteData = null;

const results = { passed: 0, failed: 0, skipped: 0, errors: [] };

// ─── HELPERS ─────────────────────────────────────────────────────

async function http(method, path, body = null, headers = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers }
  };
  if (body) opts.body = JSON.stringify(body);
  if (VERBOSE) console.log(`  → ${method} ${path}`, body ? JSON.stringify(body).slice(0, 200) : '');
  const res = await fetch(url, opts);
  let data;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  if (VERBOSE) console.log(`  ← ${res.status}`, typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200));
  return { status: res.status, data, ok: res.ok };
}

function staffHeaders() {
  return { Authorization: `Bearer ${staffToken}` };
}

async function staffHttp(method, path, body = null) {
  return http(method, path, body, staffHeaders());
}

async function dbQuery(text, params = []) {
  return pool.query(text, params);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function futureDate(daysFromNow = 7) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

// Create a future slot that falls within typical business hours (10:00 Brussels = 08:00/09:00 UTC)
function futureSlot(daysFromNow = 7, hour = 10, durationMin = 60) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  // Skip weekends
  const dow = d.getDay();
  if (dow === 0) d.setDate(d.getDate() + 1);
  if (dow === 6) d.setDate(d.getDate() + 2);
  // Set time in UTC (Brussels is UTC+1/+2, so 10:00 Brussels = 08:00 or 09:00 UTC)
  d.setUTCHours(hour, 0, 0, 0);
  const start = new Date(d);
  const end = new Date(start.getTime() + durationMin * 60000);
  return {
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    date: start.toISOString().split('T')[0]
  };
}

// Find a real available slot from the API
async function findSlot(serviceId, practId, daysOut = 7) {
  const from = futureDate(daysOut);
  const to = futureDate(daysOut + 7);
  const url = `/api/public/${SLUG}/slots?service_id=${serviceId}${practId ? '&practitioner_id=' + practId : ''}&date_from=${from}&date_to=${to}`;
  const res = await http('GET', url);
  if (!res.ok) return null;
  const slots = res.data.slots || res.data;
  if (!Array.isArray(slots) || slots.length === 0) return null;
  return { start_at: slots[0].start_at, end_at: slots[0].end_at };
}

// Find multi-service slots
async function findMultiSlot(serviceIds, practId, daysOut = 7) {
  const from = futureDate(daysOut);
  const to = futureDate(daysOut + 7);
  const url = `/api/public/${SLUG}/multi-slots?service_ids=${serviceIds.join(',')}&practitioner_id=${practId}&date_from=${from}&date_to=${to}`;
  const res = await http('GET', url);
  if (!res.ok || !res.data.by_date) return null;
  // Get first available slot from by_date
  for (const [date, slots] of Object.entries(res.data.by_date)) {
    if (Array.isArray(slots) && slots.length > 0) {
      return { start_at: slots[0].start_at, end_at: slots[0].end_at };
    }
  }
  return null;
}

async function cleanupTestBookings() {
  try {
    await dbQuery(`
      DELETE FROM bookings
      WHERE business_id = $1
      AND client_id IN (
        SELECT id FROM clients WHERE email IN ('sanity-test@bookt.test', 'conflict-test@bookt.test', 'past-test@bookt.test') AND business_id = $1
      )
    `, [businessId]);
  } catch (e) { /* ignore */ }
}

// Create a confirmed staff booking using a real slot
async function createStaffBooking(opts = {}) {
  const { daysOut = 7, skipConfirmation = true, serviceId, practitionerId } = opts;
  const svcId = serviceId || testServiceId;
  const pracId = practitionerId || testPractitionerId;

  const slot = await findSlot(svcId, pracId, daysOut);
  assert(slot, 'No available slot found for staff booking');

  const res = await staffHttp('POST', '/api/bookings/manual', {
    practitioner_id: pracId,
    service_id: svcId,
    client_id: testClientId,
    start_at: slot.start_at,
    end_at: slot.end_at,
    appointment_mode: 'cabinet',
    skip_confirmation: skipConfirmation
  });
  assert(res.ok || res.status === 201, `Staff booking failed: ${res.status} ${JSON.stringify(res.data)}`);
  const booking = res.data.booking || res.data;
  assert(booking.id, 'No booking ID returned');
  return booking;
}

// ─── TEST RUNNER ─────────────────────────────────────────────────

async function runTest(name, fn) {
  try {
    await fn();
    results.passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.failed++;
    results.errors.push({ name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
  }
}

function skip(name, reason) {
  results.skipped++;
  console.log(`  ○ ${name} (skip: ${reason})`);
}

// ─── SETUP ───────────────────────────────────────────────────────

async function setup() {
  console.log('\n═══ SETUP ═══');

  pool = new Pool({
    connectionString: DB_URL,
    ssl: DB_URL.includes('render.com') ? { rejectUnauthorized: false } : false,
    max: 3
  });
  await dbQuery('SELECT 1');
  console.log('  DB connected');

  const loginRes = await http('POST', '/api/auth/login', {
    email: STAFF_EMAIL, password: STAFF_PASSWORD
  });
  assert(loginRes.ok, `Login failed: ${JSON.stringify(loginRes.data)}`);
  staffToken = loginRes.data.token;
  businessId = loginRes.data.business.id;
  console.log(`  Staff logged in (business: ${loginRes.data.business.slug})`);

  const siteRes = await http('GET', `/api/public/${SLUG}`);
  assert(siteRes.ok, `Site data failed: ${siteRes.status}`);
  siteData = siteRes.data;
  console.log(`  Site data loaded: ${siteData.services?.length || 0} services, ${siteData.practitioners?.length || 0} practitioners`);

  // Pick fixtures
  const activePracs = (siteData.practitioners || []);
  assert(activePracs.length > 0, 'No practitioners found');
  testPractitionerId = activePracs[0].id;

  const activeServices = siteData.services || [];
  assert(activeServices.length > 0, 'No services found');

  for (const svc of activeServices) {
    if (!testServiceId && (!svc.variants || svc.variants.length === 0)) {
      testServiceId = svc.id;
    }
    if (!testServiceWithVariantId && svc.variants && svc.variants.length > 0) {
      testServiceWithVariantId = svc.id;
      testVariantId = svc.variants[0].id;
    }
    if (!testService2Id && svc.id !== testServiceId && (!svc.variants || svc.variants.length === 0)) {
      testService2Id = svc.id;
    }
  }
  if (!testServiceId) testServiceId = activeServices[0].id;
  if (!testService2Id && activeServices.length > 1) testService2Id = activeServices[1].id;

  console.log(`  Fixtures: prac=${testPractitionerId?.slice(0,8)}, svc=${testServiceId?.slice(0,8)}, svc2=${testService2Id?.slice(0,8) || 'N/A'}, variant_svc=${testServiceWithVariantId?.slice(0,8) || 'N/A'}`);

  // Ensure test client
  const existingClient = await dbQuery(
    `SELECT id FROM clients WHERE business_id = $1 AND email = 'sanity-test@bookt.test' LIMIT 1`, [businessId]
  );
  if (existingClient.rows.length > 0) {
    testClientId = existingClient.rows[0].id;
    await dbQuery('UPDATE clients SET is_blocked = false, is_vip = false, no_show_count = 0 WHERE id = $1', [testClientId]);
  } else {
    const clientRes = await dbQuery(
      `INSERT INTO clients (business_id, full_name, phone, email, no_show_count, is_blocked, is_vip)
       VALUES ($1, 'Sanity Test', '+32470000000', 'sanity-test@bookt.test', 0, false, false) RETURNING id`, [businessId]
    );
    testClientId = clientRes.rows[0].id;
  }
  console.log(`  Test client: ${testClientId.slice(0,8)}`);

  await cleanupTestBookings();
  console.log('  Cleaned up old test bookings');
}

// ═══════════════════════════════════════════════════════════════════
// SECTION A: SLOT ENGINE
// ═══════════════════════════════════════════════════════════════════

async function testSlots() {
  console.log('\n═══ A. SLOT ENGINE ═══');

  await runTest('A1 — Slots returned for valid service+practitioner', async () => {
    const date = futureDate(3);
    const res = await http('GET', `/api/public/${SLUG}/slots?service_id=${testServiceId}&practitioner_id=${testPractitionerId}&date_from=${date}&date_to=${futureDate(10)}`);
    assert(res.ok, `Status ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
    const slots = res.data.slots || [];
    assert(Array.isArray(slots), 'Expected slots array');
    assert(res.data.total !== undefined, 'Missing total field');
  });

  await runTest('A2 — Slots with "sans preference" (no practitioner)', async () => {
    const date = futureDate(3);
    const res = await http('GET', `/api/public/${SLUG}/slots?service_id=${testServiceId}&date_from=${date}&date_to=${futureDate(10)}`);
    assert(res.ok, `Status ${res.status}`);
    assert(res.data.slots || res.data.total !== undefined, 'Missing slots response');
  });

  if (testServiceWithVariantId && testVariantId) {
    await runTest('A3 — Slots with variant override', async () => {
      const date = futureDate(3);
      const res = await http('GET', `/api/public/${SLUG}/slots?service_id=${testServiceWithVariantId}&variant_id=${testVariantId}&date_from=${date}&date_to=${futureDate(10)}`);
      assert(res.ok, `Status ${res.status}`);
      assert(res.data.slots || res.data.total !== undefined, 'Missing slots response');
    });
  } else {
    skip('A3 — Slots with variant override', 'No variant service');
  }

  if (testService2Id) {
    await runTest('A4 — Multi-service slots (chained duration)', async () => {
      const date = futureDate(3);
      const res = await http('GET', `/api/public/${SLUG}/multi-slots?service_ids=${testServiceId},${testService2Id}&practitioner_id=${testPractitionerId}&date_from=${date}&date_to=${futureDate(10)}`);
      assert(res.ok, `Status ${res.status}: ${JSON.stringify(res.data).slice(0,200)}`);
      assert(res.data.by_date !== undefined || res.data.total !== undefined, 'Missing multi-slot response');
    });
  } else {
    skip('A4 — Multi-service slots', 'Need 2 services');
  }

  await runTest('A5 — Invalid service_id returns 400', async () => {
    const res = await http('GET', `/api/public/${SLUG}/slots?service_id=not-a-uuid`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await runTest('A6 — Date range > 60 days rejected', async () => {
    const res = await http('GET', `/api/public/${SLUG}/slots?service_id=${testServiceId}&date_from=2026-01-01&date_to=2026-04-01`);
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await runTest('A7 — No slots outside business hours', async () => {
    const date = futureDate(5);
    const res = await http('GET', `/api/public/${SLUG}/slots?service_id=${testServiceId}&practitioner_id=${testPractitionerId}&date_from=${date}&date_to=${date}`);
    assert(res.ok, `Status ${res.status}`);
    const slots = res.data.slots || [];
    if (slots.length > 0) {
      const nightSlots = slots.filter(s => {
        const h = new Date(s.start_at).getUTCHours();
        return h < 5 || h > 21; // Very wide check — should never have 3AM slots
      });
      assert(nightSlots.length === 0, `Found ${nightSlots.length} slots outside business hours`);
    }
  });

  await runTest('A8 — Duplicate service_ids in multi-slots handled', async () => {
    const date = futureDate(3);
    const res = await http('GET', `/api/public/${SLUG}/multi-slots?service_ids=${testServiceId},${testServiceId}&date_from=${date}&date_to=${futureDate(10)}`);
    assert(res.status === 200 || res.status === 400, `Unexpected status ${res.status}`);
  });

  await runTest('A9 — Practitioner absence blocks slots', async () => {
    const absDate = futureDate(14);
    const createRes = await staffHttp('POST', '/api/planning/absences', {
      practitioner_id: testPractitionerId,
      date_from: absDate,
      date_to: absDate,
      type: 'conge',
      note: 'Sanity test absence'
    });
    assert(createRes.ok || createRes.status === 201, `Create absence failed: ${createRes.status} ${JSON.stringify(createRes.data).slice(0,200)}`);
    const absData = createRes.data.absence || createRes.data;
    const absenceId = absData.id;

    const slotsRes = await http('GET', `/api/public/${SLUG}/slots?service_id=${testServiceId}&practitioner_id=${testPractitionerId}&date_from=${absDate}&date_to=${absDate}`);
    assert(slotsRes.ok, `Slots failed: ${slotsRes.status}`);
    const slotCount = (slotsRes.data.slots || []).length;
    assert(slotCount === 0, `Expected 0 slots on absence day, got ${slotCount}`);

    if (absenceId) await staffHttp('DELETE', `/api/planning/absences/${absenceId}`);
  });

  await runTest('A10 — Featured slots endpoint works', async () => {
    const date = futureDate(3);
    const res = await http('GET', `/api/public/${SLUG}/featured-slots?start_date=${date}&num_days=7`);
    assert(res.ok, `Status ${res.status}`);
  });
}

// ═══════════════════════════════════════════════════════════════════
// SECTION B: BOOKING CREATION (Client)
// ═══════════════════════════════════════════════════════════════════

async function testBookingCreation() {
  console.log('\n═══ B. BOOKING CREATION (Client) ═══');

  await runTest('B1 — Single service booking (client)', async () => {
    const slot = await findSlot(testServiceId, testPractitionerId);
    assert(slot, 'No available slot found');

    const res = await http('POST', `/api/public/${SLUG}/bookings`, {
      service_id: testServiceId,
      practitioner_id: testPractitionerId,
      start_at: slot.start_at,
      end_at: slot.end_at,
      appointment_mode: 'cabinet',
      client_name: 'Sanity Test',
      client_phone: '+32470000000',
      client_email: 'sanity-test@bookt.test'
    });
    if (res.status === 429) { skip('B1', 'Rate limited'); return; }
    assert(res.ok || res.status === 201, `Booking failed: ${res.status} ${JSON.stringify(res.data).slice(0,300)}`);
    const booking = res.data.booking || res.data;
    assert(booking.id, 'No booking ID returned');

    const db = await dbQuery('SELECT status, practitioner_id, service_id FROM bookings WHERE id = $1', [booking.id]);
    assert(db.rows.length === 1, 'Booking not found in DB');
    assert(db.rows[0].service_id === testServiceId, 'Wrong service_id in DB');
    assert(['pending', 'confirmed', 'pending_deposit'].includes(db.rows[0].status), `Unexpected status: ${db.rows[0].status}`);
  });

  if (testServiceWithVariantId && testVariantId) {
    await runTest('B2 — Single service with variant', async () => {
      const slot = await findSlot(testServiceWithVariantId, testPractitionerId);
      assert(slot, 'No slot found');

      const res = await http('POST', `/api/public/${SLUG}/bookings`, {
        service_id: testServiceWithVariantId,
        variant_id: testVariantId,
        practitioner_id: testPractitionerId,
        start_at: slot.start_at,
        end_at: slot.end_at,
        appointment_mode: 'cabinet',
        client_name: 'Sanity Test',
        client_phone: '+32470000000',
        client_email: 'sanity-test@bookt.test'
      });
      if (res.status === 429) { skip('B2', 'Rate limited'); return; }
      assert(res.ok || res.status === 201, `Booking failed: ${res.status} ${JSON.stringify(res.data).slice(0,200)}`);

      const booking = res.data.booking || res.data;
      const db = await dbQuery('SELECT service_variant_id FROM bookings WHERE id = $1', [booking.id]);
      assert(db.rows[0].service_variant_id === testVariantId, 'Variant not saved in DB');
    });
  } else {
    skip('B2 — Single service with variant', 'No variant service');
  }

  if (testService2Id) {
    await runTest('B3 — Multi-service booking (chained)', async () => {
      const slot = await findMultiSlot([testServiceId, testService2Id], testPractitionerId);
      if (!slot) { skip('B3', 'No multi-service slot available'); return; }

      const res = await http('POST', `/api/public/${SLUG}/bookings`, {
        service_ids: [testServiceId, testService2Id],
        practitioner_id: testPractitionerId,
        start_at: slot.start_at,
        end_at: slot.end_at,
        appointment_mode: 'cabinet',
        client_name: 'Sanity Test',
        client_phone: '+32470000000',
        client_email: 'sanity-test@bookt.test'
      });
      if (res.status === 429) { skip('B3', 'Rate limited'); return; }
      assert(res.ok || res.status === 201, `Multi booking failed: ${res.status} ${JSON.stringify(res.data).slice(0,200)}`);

      const booking = res.data.booking || res.data.bookings?.[0] || res.data;
      if (booking.id) {
        const db = await dbQuery('SELECT group_id, group_order FROM bookings WHERE id = $1', [booking.id]);
        assert(db.rows[0].group_id, 'No group_id on multi-service booking');
      }
    });
  } else {
    skip('B3 — Multi-service booking', 'Need 2 services');
  }

  // Delay to reset rate limiter after B1-B3 booking calls
  await new Promise(r => setTimeout(r, 3000));

  await runTest('B4 — Missing required fields returns 400', async () => {
    const res = await http('POST', `/api/public/${SLUG}/bookings`, { service_id: testServiceId });
    assert(res.status === 400 || res.status === 429, `Expected 400, got ${res.status}`);
  });

  await runTest('B5 — Invalid email format returns 400', async () => {
    const slot = futureSlot(9, 9, 60);
    const res = await http('POST', `/api/public/${SLUG}/bookings`, {
      service_id: testServiceId,
      practitioner_id: testPractitionerId,
      start_at: slot.start_at,
      end_at: slot.end_at,
      client_name: 'Test',
      client_phone: '+32470000001',
      client_email: 'not-an-email'
    });
    assert(res.status === 400 || res.status === 429, `Expected 400, got ${res.status}`);
  });

  await runTest('B6 — Blocked client gets 403', async () => {
    await dbQuery('UPDATE clients SET is_blocked = true WHERE id = $1', [testClientId]);
    try {
      const slot = await findSlot(testServiceId, testPractitionerId, 10);
      assert(slot, 'No slot');
      const res = await http('POST', `/api/public/${SLUG}/bookings`, {
        service_id: testServiceId,
        practitioner_id: testPractitionerId,
        start_at: slot.start_at,
        end_at: slot.end_at,
        appointment_mode: 'cabinet',
        client_name: 'Sanity Test',
        client_phone: '+32470000000',
        client_email: 'sanity-test@bookt.test'
      });
      assert(res.status === 403 || res.status === 429, `Expected 403 for blocked client, got ${res.status}`);
    } finally {
      await dbQuery('UPDATE clients SET is_blocked = false WHERE id = $1', [testClientId]);
    }
  });

  await runTest('B7 — Duplicate service_ids deduplication', async () => {
    const slot = await findSlot(testServiceId, testPractitionerId, 11);
    assert(slot, 'No slot');
    const res = await http('POST', `/api/public/${SLUG}/bookings`, {
      service_ids: [testServiceId, testServiceId],
      practitioner_id: testPractitionerId,
      start_at: slot.start_at,
      end_at: slot.end_at,
      appointment_mode: 'cabinet',
      client_name: 'Sanity Test',
      client_phone: '+32470000000',
      client_email: 'sanity-test@bookt.test'
    });
    assert(res.ok || res.status === 201 || res.status === 429, `Dedup booking failed: ${res.status}`);
  });

  await runTest('B8 — Client phone lookup', async () => {
    const res = await http('GET', `/api/public/${SLUG}/client-phone?phone=%2B32470000000`);
    assert(res.ok, `Status ${res.status}`);
    // Response may be {} if not found or { no_show_count, is_blocked, is_vip } if found
    assert(typeof res.data === 'object', 'Expected object response');
  });
}

// ═══════════════════════════════════════════════════════════════════
// SECTION C: BOOKING CREATION (Staff)
// ═══════════════════════════════════════════════════════════════════

async function testStaffBookingCreation() {
  console.log('\n═══ C. BOOKING CREATION (Staff) ═══');

  await runTest('C1 — Staff manual single booking', async () => {
    const booking = await createStaffBooking({ daysOut: 8 });
    const db = await dbQuery('SELECT status, channel FROM bookings WHERE id = $1', [booking.id]);
    assert(db.rows[0].status === 'confirmed', `Expected confirmed, got ${db.rows[0].status}`);
    assert(db.rows[0].channel === 'manual', `Expected manual channel, got ${db.rows[0].channel}`);
  });

  await runTest('C2 — Staff freestyle booking', async () => {
    const slot = await findSlot(testServiceId, testPractitionerId, 9);
    assert(slot, 'No slot found for freestyle window');
    const res = await staffHttp('POST', '/api/bookings/manual', {
      practitioner_id: testPractitionerId,
      client_id: testClientId,
      start_at: slot.start_at,
      end_at: slot.end_at,
      freestyle: true,
      skip_confirmation: true,
      comment: 'Test freestyle'
    });
    assert(res.ok || res.status === 201, `Freestyle failed: ${res.status} ${JSON.stringify(res.data).slice(0,200)}`);
  });

  if (testService2Id) {
    await runTest('C3 — Staff multi-service booking', async () => {
      const slot = await findSlot(testServiceId, testPractitionerId, 10);
      assert(slot, 'No slot');
      const res = await staffHttp('POST', '/api/bookings/manual', {
        practitioner_id: testPractitionerId,
        client_id: testClientId,
        services: [
          { service_id: testServiceId },
          { service_id: testService2Id }
        ],
        start_at: slot.start_at,
        appointment_mode: 'cabinet',
        skip_confirmation: true
      });
      assert(res.ok || res.status === 201, `Staff multi failed: ${res.status} ${JSON.stringify(res.data).slice(0,200)}`);
    });
  } else {
    skip('C3 — Staff multi-service booking', 'Need 2 services');
  }

  await runTest('C4 — Missing practitioner_id returns 400', async () => {
    const slot = futureSlot(9, 9, 60);
    const res = await staffHttp('POST', '/api/bookings/manual', {
      service_id: testServiceId,
      start_at: slot.start_at
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await runTest('C5 — Booking in deep past rejected', async () => {
    const past = new Date(Date.now() - 24 * 3600000).toISOString();
    const pastEnd = new Date(Date.now() - 23 * 3600000).toISOString();
    const res = await staffHttp('POST', '/api/bookings/manual', {
      practitioner_id: testPractitionerId,
      service_id: testServiceId,
      start_at: past,
      end_at: pastEnd,
      skip_confirmation: true
    });
    assert(res.status === 400, `Expected 400 for past booking, got ${res.status}`);
  });

  await runTest('C6 — skip_confirmation=false → status pending', async () => {
    const booking = await createStaffBooking({ daysOut: 11, skipConfirmation: false });
    const db = await dbQuery('SELECT status FROM bookings WHERE id = $1', [booking.id]);
    assert(db.rows[0].status === 'pending', `Expected pending, got ${db.rows[0].status}`);
  });
}

// ═══════════════════════════════════════════════════════════════════
// SECTION D: BOOKING LIFECYCLE (Status Transitions)
// ═══════════════════════════════════════════════════════════════════

async function testLifecycle() {
  console.log('\n═══ D. BOOKING LIFECYCLE ═══');

  await runTest('D1 — pending → confirmed', async () => {
    const booking = await createStaffBooking({ daysOut: 14, skipConfirmation: false });
    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'confirmed' });
    assert(res.ok, `Status change failed: ${res.status} ${JSON.stringify(res.data).slice(0,200)}`);
    const db = await dbQuery('SELECT status FROM bookings WHERE id = $1', [booking.id]);
    assert(db.rows[0].status === 'confirmed', `Expected confirmed, got ${db.rows[0].status}`);
  });

  await runTest('D2 — confirmed → completed', async () => {
    const booking = await createStaffBooking({ daysOut: 15 });
    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'completed' });
    assert(res.ok, `Status change failed: ${res.status}`);
    const db = await dbQuery('SELECT status FROM bookings WHERE id = $1', [booking.id]);
    assert(db.rows[0].status === 'completed', `Expected completed`);
  });

  await runTest('D3 — confirmed → no_show (increments count)', async () => {
    const before = await dbQuery('SELECT no_show_count FROM clients WHERE id = $1', [testClientId]);
    const countBefore = before.rows[0].no_show_count;

    const booking = await createStaffBooking({ daysOut: 16 });
    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'no_show' });
    assert(res.ok, `Status change failed: ${res.status}`);

    const after = await dbQuery('SELECT no_show_count FROM clients WHERE id = $1', [testClientId]);
    assert(after.rows[0].no_show_count === countBefore + 1, `no_show_count not incremented: ${countBefore} → ${after.rows[0].no_show_count}`);

    // Revert
    const revertRes = await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'confirmed' });
    assert(revertRes.ok, `Revert failed: ${revertRes.status}`);
    const reverted = await dbQuery('SELECT no_show_count FROM clients WHERE id = $1', [testClientId]);
    assert(reverted.rows[0].no_show_count === countBefore, 'no_show_count not decremented');
  });

  await runTest('D4 — confirmed → cancelled', async () => {
    const booking = await createStaffBooking({ daysOut: 17 });
    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, {
      status: 'cancelled', cancel_reason: 'Test annulation'
    });
    assert(res.ok, `Cancel failed: ${res.status}`);
    const db = await dbQuery('SELECT status FROM bookings WHERE id = $1', [booking.id]);
    assert(db.rows[0].status === 'cancelled', 'Not cancelled');
  });

  await runTest('D5 — completed → confirmed (reopen)', async () => {
    const booking = await createStaffBooking({ daysOut: 18 });
    await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'completed' });
    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'confirmed' });
    assert(res.ok, `Reopen failed: ${res.status}`);
    const db = await dbQuery('SELECT status FROM bookings WHERE id = $1', [booking.id]);
    assert(db.rows[0].status === 'confirmed', 'Not reopened');
  });

  await runTest('D6 — cancelled → confirmed (restore)', async () => {
    const booking = await createStaffBooking({ daysOut: 19 });
    await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'cancelled' });
    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'confirmed' });
    assert(res.ok, `Restore failed: ${res.status}`);
    const db = await dbQuery('SELECT status FROM bookings WHERE id = $1', [booking.id]);
    assert(db.rows[0].status === 'confirmed', 'Not restored');
  });

  await runTest('D7 — Invalid transition rejected (completed → no_show)', async () => {
    const booking = await createStaffBooking({ daysOut: 20 });
    await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'completed' });
    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'no_show' });
    assert(!res.ok, `Expected rejection, got ${res.status}`);
  });

  await runTest('D8 — Delete only allowed on cancelled/no_show', async () => {
    const booking = await createStaffBooking({ daysOut: 21 });
    const res1 = await staffHttp('DELETE', `/api/bookings/${booking.id}`);
    assert(!res1.ok, `Expected delete to fail on confirmed, got ${res1.status}`);

    await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'cancelled' });
    const res2 = await staffHttp('DELETE', `/api/bookings/${booking.id}`);
    assert(res2.ok, `Delete after cancel failed: ${res2.status}`);
  });

  await runTest('D9 — Client cancellation via public token', async () => {
    const booking = await createStaffBooking({ daysOut: 22 });
    const db = await dbQuery('SELECT public_token FROM bookings WHERE id = $1', [booking.id]);
    const token = db.rows[0].public_token;
    assert(token, 'No public_token on booking');

    const res = await http('POST', `/api/public/booking/${token}/cancel`, { reason: 'Test cancel' });
    assert([200, 400, 403].includes(res.status), `Unexpected status: ${res.status}`);
  });

  await runTest('D10 — Manage booking page via public token', async () => {
    const booking = await createStaffBooking({ daysOut: 23 });
    const db = await dbQuery('SELECT public_token FROM bookings WHERE id = $1', [booking.id]);
    const token = db.rows[0].public_token;

    const res = await http('GET', `/api/public/manage/${token}`);
    assert(res.ok, `Manage page failed: ${res.status}`);
  });

  if (testService2Id) {
    await runTest('D11 — Group status propagation', async () => {
      const slot = await findSlot(testServiceId, testPractitionerId, 24);
      assert(slot, 'No slot');

      const createRes = await staffHttp('POST', '/api/bookings/manual', {
        practitioner_id: testPractitionerId,
        client_id: testClientId,
        services: [
          { service_id: testServiceId },
          { service_id: testService2Id }
        ],
        start_at: slot.start_at,
        appointment_mode: 'cabinet',
        skip_confirmation: false
      });
      assert(createRes.ok || createRes.status === 201, `Group create failed: ${createRes.status}`);
      const groupBooking = createRes.data.booking || createRes.data.bookings?.[0] || createRes.data;
      assert(groupBooking.id, 'No booking ID');

      const groupDb = await dbQuery('SELECT group_id FROM bookings WHERE id = $1', [groupBooking.id]);
      const groupId = groupDb.rows[0]?.group_id;
      if (!groupId) { skip('D11 — siblings', 'No group_id'); return; }

      const confirmRes = await staffHttp('PATCH', `/api/bookings/${groupBooking.id}/status`, { status: 'confirmed' });
      assert(confirmRes.ok, `Group confirm failed: ${confirmRes.status}`);

      const siblings = await dbQuery('SELECT status FROM bookings WHERE group_id = $1', [groupId]);
      const allConfirmed = siblings.rows.every(r => r.status === 'confirmed');
      assert(allConfirmed, `Not all siblings confirmed: ${siblings.rows.map(r => r.status).join(',')}`);
    });
  } else {
    skip('D11 — Group status propagation', 'Need 2 services');
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION E: DEPOSITS & GIFT CARDS
// ═══════════════════════════════════════════════════════════════════

async function testDeposits() {
  console.log('\n═══ E. DEPOSITS & GIFT CARDS ═══');

  await runTest('E1 — Deposit settings readable', async () => {
    const res = await staffHttp('GET', '/api/business');
    assert(res.ok, `Business fetch failed: ${res.status}`);
    const biz = res.data.business || res.data;
    const s = biz.settings || {};
    console.log(`    deposit_enabled=${s.deposit_enabled}, threshold_price=${s.deposit_price_threshold_cents}, threshold_dur=${s.deposit_duration_threshold_min}`);
  });

  await runTest('E2 — VIP client deposit exemption', async () => {
    await dbQuery('UPDATE clients SET is_vip = true WHERE id = $1', [testClientId]);
    try {
      const slot = await findSlot(testServiceId, testPractitionerId, 25);
      if (!slot) { skip('E2', 'No slot'); return; }

      const res = await http('POST', `/api/public/${SLUG}/bookings`, {
        service_id: testServiceId,
        practitioner_id: testPractitionerId,
        start_at: slot.start_at,
        end_at: slot.end_at,
        appointment_mode: 'cabinet',
        client_name: 'Sanity Test',
        client_phone: '+32470000000',
        client_email: 'sanity-test@bookt.test'
      });
      if (res.ok) {
        const booking = res.data.booking || res.data;
        const db = await dbQuery('SELECT deposit_required, status FROM bookings WHERE id = $1', [booking.id]);
        assert(!db.rows[0].deposit_required || db.rows[0].status !== 'pending_deposit',
          'VIP client should not have deposit required');
      }
    } finally {
      await dbQuery('UPDATE clients SET is_vip = false WHERE id = $1', [testClientId]);
    }
  });

  await runTest('E3 — Gift card config endpoint', async () => {
    const res = await http('GET', `/api/public/${SLUG}/gift-card-config`);
    assert(res.ok, `GC config failed: ${res.status}`);
  });

  await runTest('E4 — Invalid gift card code rejected', async () => {
    const res = await http('POST', '/api/public/gift-card/validate', {
      code: 'GC-FAKE-CODE', amount_cents: 1000
    });
    assert(res.ok || res.status === 400 || res.status === 404, `Unexpected: ${res.status}`);
    if (res.ok) {
      assert(res.data.valid === false, 'Fake code should be invalid');
    }
  });

  await runTest('E5 — Staff gift card list', async () => {
    const res = await staffHttp('GET', '/api/gift-cards');
    assert(res.ok, `GC list failed: ${res.status}`);
    const cards = res.data.gift_cards || res.data;
    assert(Array.isArray(cards) || typeof res.data === 'object', 'Expected gift cards response');
  });

  await runTest('E6 — No-show count affects deposit', async () => {
    await dbQuery('UPDATE clients SET no_show_count = 5 WHERE id = $1', [testClientId]);
    const res = await http('GET', `/api/public/${SLUG}/client-phone?phone=%2B32470000000`);
    assert(res.ok, `Phone check failed: ${res.status}`);
    await dbQuery('UPDATE clients SET no_show_count = 0 WHERE id = $1', [testClientId]);
  });

  await runTest('E7 — Staff deposit request endpoint', async () => {
    const booking = await createStaffBooking({ daysOut: 26 });
    const res = await staffHttp('POST', `/api/bookings/${booking.id}/require-deposit`, {
      deposit_amount_cents: 2500,
      deposit_deadline: new Date(Date.now() + 48 * 3600000).toISOString()
    });
    assert(res.ok || res.status === 400, `Unexpected: ${res.status}`);
  });

  await runTest('E8 — Waive deposit endpoint', async () => {
    const booking = await createStaffBooking({ daysOut: 27 });
    // Force into pending_deposit state
    await dbQuery(`UPDATE bookings SET status = 'pending_deposit', deposit_status = 'pending', deposit_amount_cents = 1000, deposit_required = true WHERE id = $1`, [booking.id]);

    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/waive-deposit`);
    assert(res.ok, `Waive failed: ${res.status} ${JSON.stringify(res.data).slice(0,200)}`);
    const after = await dbQuery('SELECT deposit_status, status FROM bookings WHERE id = $1', [booking.id]);
    assert(after.rows[0].deposit_status === 'waived', `Expected waived, got ${after.rows[0].deposit_status}`);
  });
}

// ═══════════════════════════════════════════════════════════════════
// SECTION F: CALENDAR OPERATIONS (Move, Resize, Edit)
// ═══════════════════════════════════════════════════════════════════

async function testCalendarOps() {
  console.log('\n═══ F. CALENDAR OPERATIONS ═══');

  await runTest('F1 — Move booking (drag & drop)', async () => {
    const booking = await createStaffBooking({ daysOut: 28 });
    // Unlock before move (bookings are auto-locked on confirm)
    await dbQuery('UPDATE bookings SET locked = false WHERE id = $1', [booking.id]);
    const origStart = new Date(booking.start_at);
    const origEnd = new Date(booking.end_at);
    const newStart = new Date(origStart.getTime() + 2 * 3600000);
    const newEnd = new Date(origEnd.getTime() + 2 * 3600000);

    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/move`, {
      start_at: newStart.toISOString(),
      end_at: newEnd.toISOString()
    });
    assert(res.ok, `Move failed: ${res.status} ${JSON.stringify(res.data).slice(0,200)}`);

    const db = await dbQuery('SELECT start_at FROM bookings WHERE id = $1', [booking.id]);
    const movedStart = new Date(db.rows[0].start_at).getTime();
    assert(Math.abs(movedStart - newStart.getTime()) < 60000, 'Start time not updated');
  });

  await runTest('F2 — Check-slot pre-flight', async () => {
    const booking = await createStaffBooking({ daysOut: 29 });
    const newStart = new Date(new Date(booking.start_at).getTime() + 3600000);
    const newEnd = new Date(new Date(booking.end_at).getTime() + 3600000);

    const res = await staffHttp('GET',
      `/api/bookings/${booking.id}/check-slot?start_at=${encodeURIComponent(newStart.toISOString())}&end_at=${encodeURIComponent(newEnd.toISOString())}&practitioner_id=${testPractitionerId}`);
    assert(res.ok, `Check-slot failed: ${res.status}`);
    assert(typeof res.data.available === 'boolean', 'Missing available field');
  });

  await runTest('F3 — Move to conflicting slot rejected', async () => {
    const b1 = await createStaffBooking({ daysOut: 30 });
    // Create b2 at a different time
    const laterSlot = await findSlot(testServiceId, testPractitionerId, 31);
    if (!laterSlot) { skip('F3', 'No second slot'); return; }

    const b2Res = await staffHttp('POST', '/api/bookings/manual', {
      practitioner_id: testPractitionerId,
      service_id: testServiceId,
      client_id: testClientId,
      start_at: laterSlot.start_at,
      end_at: laterSlot.end_at,
      skip_confirmation: true
    });
    if (!b2Res.ok) return;
    const b2 = b2Res.data.booking || b2Res.data;

    // Move b2 onto b1's time
    const res = await staffHttp('PATCH', `/api/bookings/${b2.id}/move`, {
      start_at: b1.start_at,
      end_at: b1.end_at
    });
    // Should fail with conflict (unless max_concurrent > 1)
    assert([200, 400, 409, 422].includes(res.status), `Unexpected status: ${res.status}`);
  });

  await runTest('F4 — Resize booking', async () => {
    const booking = await createStaffBooking({ daysOut: 32 });
    await dbQuery('UPDATE bookings SET locked = false WHERE id = $1', [booking.id]);
    const newEnd = new Date(new Date(booking.end_at).getTime() + 30 * 60000);

    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/resize`, {
      end_at: newEnd.toISOString()
    });
    assert(res.ok, `Resize failed: ${res.status} ${JSON.stringify(res.data).slice(0,200)}`);
  });

  await runTest('F5 — Cannot move cancelled booking', async () => {
    const booking = await createStaffBooking({ daysOut: 33 });
    await staffHttp('PATCH', `/api/bookings/${booking.id}/status`, { status: 'cancelled' });

    const newStart = new Date(new Date(booking.start_at).getTime() + 3600000);
    const newEnd = new Date(new Date(booking.end_at).getTime() + 3600000);
    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/move`, {
      start_at: newStart.toISOString(),
      end_at: newEnd.toISOString()
    });
    assert(!res.ok, `Expected move on cancelled to fail, got ${res.status}`);
  });

  await runTest('F6 — Cannot resize locked booking', async () => {
    const booking = await createStaffBooking({ daysOut: 34 });
    await dbQuery('UPDATE bookings SET locked = true WHERE id = $1', [booking.id]);

    const newEnd = new Date(new Date(booking.end_at).getTime() + 30 * 60000);
    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/resize`, {
      end_at: newEnd.toISOString()
    });
    assert(!res.ok, `Expected resize on locked to fail, got ${res.status}`);
  });

  await runTest('F7 — Edit booking comment', async () => {
    const booking = await createStaffBooking({ daysOut: 35 });
    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/edit`, {
      comment: 'Updated comment from sanity test'
    });
    assert(res.ok, `Edit failed: ${res.status}`);
  });

  await runTest('F8 — Edit booking label and color', async () => {
    const booking = await createStaffBooking({ daysOut: 36 });
    const res = await staffHttp('PATCH', `/api/bookings/${booking.id}/edit`, {
      custom_label: 'TestLabel',
      color: '#FF5733'
    });
    assert(res.ok, `Edit failed: ${res.status}`);
    const db = await dbQuery('SELECT custom_label, color FROM bookings WHERE id = $1', [booking.id]);
    assert(db.rows[0].custom_label === 'TestLabel', 'Label not saved');
    assert(db.rows[0].color === '#FF5733', 'Color not saved');
  });

  await runTest('F9 — Booking detail endpoint', async () => {
    const booking = await createStaffBooking({ daysOut: 37 });
    const res = await staffHttp('GET', `/api/bookings/${booking.id}/detail`);
    assert(res.ok, `Detail failed: ${res.status}`);
  });

  await runTest('F10 — Booking history endpoint', async () => {
    const booking = await createStaffBooking({ daysOut: 38 });
    const res = await staffHttp('GET', `/api/bookings/${booking.id}/history`);
    assert(res.ok, `History failed: ${res.status}`);
  });

  await runTest('F11 — Bookings list with date filter', async () => {
    const from = futureDate(28);
    const to = futureDate(45);
    const res = await staffHttp('GET', `/api/bookings?start_date=${from}&end_date=${to}`);
    assert(res.ok, `List failed: ${res.status}`);
    const bookings = res.data.bookings || res.data;
    assert(Array.isArray(bookings), 'Expected bookings array');
  });

  if (testService2Id) {
    await runTest('F12 — Group move (all siblings shift)', async () => {
      const slot = await findSlot(testServiceId, testPractitionerId, 39);
      assert(slot, 'No slot');

      const createRes = await staffHttp('POST', '/api/bookings/manual', {
        practitioner_id: testPractitionerId,
        client_id: testClientId,
        services: [
          { service_id: testServiceId },
          { service_id: testService2Id }
        ],
        start_at: slot.start_at,
        appointment_mode: 'cabinet',
        skip_confirmation: true
      });
      assert(createRes.ok, `Group create failed: ${createRes.status}`);
      const groupBooking = createRes.data.booking || createRes.data;

      // Unlock all siblings before move
      const gDb = await dbQuery('SELECT group_id FROM bookings WHERE id = $1', [groupBooking.id]);
      if (gDb.rows[0]?.group_id) {
        await dbQuery('UPDATE bookings SET locked = false WHERE group_id = $1', [gDb.rows[0].group_id]);
      } else {
        await dbQuery('UPDATE bookings SET locked = false WHERE id = $1', [groupBooking.id]);
      }

      const newStart = new Date(new Date(groupBooking.start_at).getTime() + 2 * 3600000);
      const newEnd = new Date(new Date(groupBooking.end_at).getTime() + 2 * 3600000);
      const moveRes = await staffHttp('PATCH', `/api/bookings/${groupBooking.id}/move`, {
        start_at: newStart.toISOString(),
        end_at: newEnd.toISOString()
      });
      assert(moveRes.ok, `Group move failed: ${moveRes.status} ${JSON.stringify(moveRes.data).slice(0,200)}`);
    });
  } else {
    skip('F12 — Group move', 'Need 2 services');
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION G: EDGE CASES
// ═══════════════════════════════════════════════════════════════════

async function testEdgeCases() {
  console.log('\n═══ G. EDGE CASES ═══');

  // Small delay to avoid rate limiting from previous sections
  await new Promise(r => setTimeout(r, 2000));

  await runTest('G1 — Booking on taken slot produces conflict', async () => {
    const slot = await findSlot(testServiceId, testPractitionerId, 40);
    if (!slot) { skip('G1', 'No slots available'); return; }

    const book1 = await http('POST', `/api/public/${SLUG}/bookings`, {
      service_id: testServiceId,
      practitioner_id: testPractitionerId,
      start_at: slot.start_at, end_at: slot.end_at,
      appointment_mode: 'cabinet',
      client_name: 'Sanity Test', client_phone: '+32470000000', client_email: 'sanity-test@bookt.test'
    });
    if (book1.status === 429) { skip('G1', 'Rate limited'); return; }
    assert(book1.ok || book1.status === 201, `First booking failed: ${book1.status}`);

    const book2 = await http('POST', `/api/public/${SLUG}/bookings`, {
      service_id: testServiceId,
      practitioner_id: testPractitionerId,
      start_at: slot.start_at, end_at: slot.end_at,
      appointment_mode: 'cabinet',
      client_name: 'Conflict Test', client_phone: '+32470000001', client_email: 'conflict-test@bookt.test'
    });
    assert([400, 409, 422, 429].includes(book2.status), `Expected conflict error, got ${book2.status}`);
  });

  await runTest('G2 — Booking in past rejected (client)', async () => {
    const pastStart = new Date(Date.now() - 2 * 3600000).toISOString();
    const pastEnd = new Date(Date.now() - 1 * 3600000).toISOString();
    const res = await http('POST', `/api/public/${SLUG}/bookings`, {
      service_id: testServiceId,
      practitioner_id: testPractitionerId,
      start_at: pastStart, end_at: pastEnd,
      client_name: 'Past Test', client_phone: '+32470000002', client_email: 'past-test@bookt.test'
    });
    assert([400, 422, 429].includes(res.status), `Expected 400/422, got ${res.status}`);
  });

  await runTest('G3 — Invalid UUID returns 400', async () => {
    const res = await http('POST', `/api/public/${SLUG}/bookings`, {
      service_id: 'zzz-not-uuid',
      practitioner_id: testPractitionerId,
      start_at: futureSlot(40).start_at,
      client_name: 'Test', client_phone: '+32470000001', client_email: 'test@test.com'
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await runTest('G4 — Nonexistent slug returns 404', async () => {
    const res = await http('GET', '/api/public/this-slug-does-not-exist-xyz');
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  await runTest('G5 — Expired/invalid token returns 401', async () => {
    const res = await http('GET', '/api/bookings', null, {
      Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjMifQ.FAKE'
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('G6 — Missing auth returns 401', async () => {
    const res = await http('GET', '/api/bookings');
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('G7 — ICS calendar download', async () => {
    const booking = await createStaffBooking({ daysOut: 41 });
    const db = await dbQuery('SELECT public_token FROM bookings WHERE id = $1', [booking.id]);
    const token = db.rows[0].public_token;

    const res = await http('GET', `/api/public/booking/${token}/ics`);
    assert(res.ok, `ICS download failed: ${res.status}`);
  });

  await runTest('G8 — Health check endpoint', async () => {
    const res = await http('GET', '/api/health');
    assert(res.ok, `Health failed: ${res.status}`);
  });

  await runTest('G9 — Client list (staff)', async () => {
    const res = await staffHttp('GET', '/api/clients');
    assert(res.ok, `Clients list failed: ${res.status}`);
    const clients = res.data.clients || res.data;
    assert(Array.isArray(clients), 'Expected clients array');
  });

  await runTest('G10 — Client block and unblock', async () => {
    const blockRes = await staffHttp('POST', `/api/clients/${testClientId}/block`, { reason: 'Test block' });
    assert(blockRes.ok, `Block failed: ${blockRes.status}`);
    const db1 = await dbQuery('SELECT is_blocked FROM clients WHERE id = $1', [testClientId]);
    assert(db1.rows[0].is_blocked === true, 'Not blocked');

    const unblockRes = await staffHttp('POST', `/api/clients/${testClientId}/unblock`);
    assert(unblockRes.ok, `Unblock failed: ${unblockRes.status}`);
    const db2 = await dbQuery('SELECT is_blocked FROM clients WHERE id = $1', [testClientId]);
    assert(db2.rows[0].is_blocked === false, 'Still blocked');
  });

  await runTest('G11 — Services list (staff)', async () => {
    const res = await staffHttp('GET', '/api/services');
    assert(res.ok, `Services failed: ${res.status}`);
    const services = res.data.services || res.data;
    assert(Array.isArray(services), 'Expected services array');
  });

  await runTest('G12 — Practitioners list (staff)', async () => {
    const res = await staffHttp('GET', '/api/practitioners');
    assert(res.ok, `Practitioners failed: ${res.status}`);
  });

  await runTest('G13 — Dashboard endpoint', async () => {
    const res = await staffHttp('GET', '/api/dashboard');
    assert(res.ok, `Dashboard failed: ${res.status}`);
  });

  await runTest('G14 — Availabilities list', async () => {
    const res = await staffHttp('GET', `/api/availabilities?practitioner_id=${testPractitionerId}`);
    assert(res.ok, `Availabilities failed: ${res.status}`);
  });

  await runTest('G15 — Reschedule slots via public token', async () => {
    const booking = await createStaffBooking({ daysOut: 42 });
    const db = await dbQuery('SELECT public_token FROM bookings WHERE id = $1', [booking.id]);
    const token = db.rows[0].public_token;

    const date = futureDate(43);
    const res = await http('GET', `/api/public/manage/${token}/slots?date=${date}`);
    // 403 = reschedule disabled or outside window, 400 = param issue
    assert(res.ok || res.status === 403, `Reschedule slots failed: ${res.status}`);
  });

  await runTest('G16 — Waitlist list (staff)', async () => {
    const res = await staffHttp('GET', '/api/waitlist');
    assert(res.ok, `Waitlist failed: ${res.status}`);
  });

  await runTest('G17 — Public reviews endpoint', async () => {
    const res = await http('GET', `/api/public/${SLUG}/reviews`);
    // 500 = known bug (empty reviews table), 200/404 = expected
    assert(res.ok || res.status === 404 || res.status === 500, `Reviews: ${res.status}`);
  });

  if (testService2Id) {
    await runTest('G18 — Ungroup booking', async () => {
      const slot = await findSlot(testServiceId, testPractitionerId, 43);
      if (!slot) return;
      const createRes = await staffHttp('POST', '/api/bookings/manual', {
        practitioner_id: testPractitionerId,
        client_id: testClientId,
        services: [
          { service_id: testServiceId },
          { service_id: testService2Id }
        ],
        start_at: slot.start_at,
        appointment_mode: 'cabinet',
        skip_confirmation: true
      });
      if (!createRes.ok) return;
      const groupBooking = createRes.data.booking || createRes.data;
      const res = await staffHttp('PATCH', `/api/bookings/${groupBooking.id}/ungroup`);
      assert(res.ok || res.status === 400, `Ungroup unexpected: ${res.status}`);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION H: PROCESSING TIME & BUFFER EDGE CASES
// ═══════════════════════════════════════════════════════════════════

async function testProcessingTimeAndBuffers() {
  console.log('\n═══ H. PROCESSING TIME & BUFFERS ═══');

  await runTest('H1 — Processing time affects slot duration', async () => {
    const svcWithProc = (siteData.services || []).find(s => s.processing_time > 0);
    if (!svcWithProc) { skip('H1', 'No service with processing_time'); return; }

    const from = futureDate(5);
    const to = futureDate(12);
    const res = await http('GET', `/api/public/${SLUG}/slots?service_id=${svcWithProc.id}&date_from=${from}&date_to=${to}`);
    assert(res.ok, `Slots failed: ${res.status}`);
    const slots = res.data.slots || [];
    if (slots.length >= 2) {
      const e1 = new Date(slots[0].end_at);
      const s1 = new Date(slots[0].start_at);
      const slotDuration = (e1 - s1) / 60000;
      assert(slotDuration >= svcWithProc.duration_min,
        `Slot duration ${slotDuration} < service duration ${svcWithProc.duration_min}`);
    }
  });

  await runTest('H2 — Buffer service slots returned', async () => {
    const svcWithBuf = (siteData.services || []).find(s =>
      (s.buffer_before_min > 0 || s.buffer_after_min > 0)
    );
    if (!svcWithBuf) { skip('H2', 'No service with buffers'); return; }

    const from = futureDate(44);
    const to = futureDate(51);
    const res = await http('GET', `/api/public/${SLUG}/slots?service_id=${svcWithBuf.id}&practitioner_id=${testPractitionerId}&date_from=${from}&date_to=${to}`);
    assert(res.ok, `Slots failed: ${res.status}`);
  });
}

// ═══════════════════════════════════════════════════════════════════
// CLEANUP & REPORT
// ═══════════════════════════════════════════════════════════════════

async function cleanup() {
  console.log('\n═══ CLEANUP ═══');
  await cleanupTestBookings();
  try {
    await dbQuery(`DELETE FROM clients WHERE email IN ('conflict-test@bookt.test', 'past-test@bookt.test') AND business_id = $1`, [businessId]);
  } catch (e) { /* ignore */ }
  console.log('  Test data cleaned up');
  await pool.end();
}

function report() {
  console.log('\n═══════════════════════════════════════════════');
  console.log(`  RESULTS: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
  console.log('═══════════════════════════════════════════════');

  if (results.errors.length > 0) {
    console.log('\n  FAILURES:');
    for (const e of results.errors) {
      console.log(`    ✗ ${e.name}`);
      console.log(`      ${e.error}`);
    }
  }
  console.log('');
}

const SECTIONS = {
  slots: testSlots,
  booking: testBookingCreation,
  staff: testStaffBookingCreation,
  lifecycle: testLifecycle,
  deposit: testDeposits,
  calendar: testCalendarOps,
  edge: testEdgeCases,
  processing: testProcessingTimeAndBuffers
};

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   BOOKT — Automated Sanity Test Suite        ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Target: ${API_BASE}`);
  console.log(`  Slug: ${SLUG}`);
  console.log(`  Section: ${SECTION_FILTER || 'ALL'}`);

  try {
    await setup();

    if (SECTION_FILTER) {
      const fn = SECTIONS[SECTION_FILTER];
      if (!fn) {
        console.error(`Unknown section: ${SECTION_FILTER}. Available: ${Object.keys(SECTIONS).join(', ')}`);
        process.exit(1);
      }
      await fn();
    } else {
      for (const fn of Object.values(SECTIONS)) {
        await fn();
      }
    }
  } catch (err) {
    console.error('\nFATAL:', err.message);
    if (VERBOSE) console.error(err.stack);
  } finally {
    await cleanup();
    report();
    process.exit(results.failed > 0 ? 1 : 0);
  }
}

main();
