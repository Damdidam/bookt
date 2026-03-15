require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

(async () => {
  const biz = await pool.query("SELECT id, name, slug FROM businesses WHERE slug = 'esthetikz'");
  if (!biz.rows[0]) { console.log('No business found'); await pool.end(); return; }
  const bid = biz.rows[0].id;
  console.log('Business:', biz.rows[0].name, bid);

  const pracs = await pool.query('SELECT id, display_name FROM practitioners WHERE business_id = $1', [bid]);
  console.log('\nPractitioners:');
  pracs.rows.forEach(r => console.log(' ', r.display_name, r.id.substring(0,8)));

  const svcs = await pool.query('SELECT s.id, s.name, s.duration_min, s.buffer_before_min, s.buffer_after_min, s.available_schedule FROM services s WHERE s.business_id = $1 ORDER BY s.name', [bid]);
  console.log('\nServices:');
  svcs.rows.forEach(s => console.log(' ', s.name, '|', s.duration_min+'min', '| buf:', s.buffer_before_min||0, '/', s.buffer_after_min||0, '| avail:', s.available_schedule ? JSON.stringify(s.available_schedule).substring(0,80) : 'null'));

  const ps = await pool.query('SELECT ps.practitioner_id, p.display_name, array_agg(s.name ORDER BY s.name) as services FROM practitioner_services ps JOIN practitioners p ON p.id = ps.practitioner_id JOIN services s ON s.id = ps.service_id WHERE ps.business_id = $1 GROUP BY ps.practitioner_id, p.display_name', [bid]);
  console.log('\nPractitioner assignments:');
  ps.rows.forEach(r => console.log(' ', r.display_name, ':', r.services.length, 'services -', r.services.join(', ')));

  const scheds = await pool.query('SELECT p.display_name, a.day_of_week, a.start_time, a.end_time FROM availabilities a JOIN practitioners p ON p.id = a.practitioner_id WHERE a.business_id = $1 ORDER BY p.display_name, a.day_of_week, a.start_time', [bid]);
  console.log('\nPractitioner schedules:');
  scheds.rows.forEach(r => console.log(' ', r.display_name, '| day', r.day_of_week, '|', r.start_time, '-', r.end_time));

  const bsched = await pool.query('SELECT day_of_week, start_time, end_time FROM business_schedule WHERE business_id = $1 ORDER BY day_of_week, start_time', [bid]);
  console.log('\nBusiness hours:');
  bsched.rows.forEach(r => console.log('  day', r.day_of_week, '|', r.start_time, '-', r.end_time));

  // Check variants for the services in the screenshot
  const vars = await pool.query("SELECT sv.name, sv.duration_min, s.name as svc_name FROM service_variants sv JOIN services s ON s.id = sv.service_id WHERE sv.business_id = $1 AND sv.is_active = true ORDER BY s.name, sv.name", [bid]);
  console.log('\nActive variants:');
  vars.rows.forEach(v => console.log(' ', v.svc_name, '-', v.name, '|', v.duration_min+'min'));

  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
