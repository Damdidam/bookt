#!/usr/bin/env node
/**
 * test-call-filter.js
 * Simule tous les scénarios de filtrage d'appels en local
 * 
 * Usage: node test-call-filter.js
 * Prérequis: serveur lancé sur localhost:3000, DB avec seed data
 * 
 * Ce script POST directement sur les webhooks et vérifie le TwiML retourné.
 * Pas besoin de Twilio — tout se passe en local.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TOKEN = process.env.TEST_TOKEN || ''; // JWT token d'un owner

// ============================================================
// CONFIG — Ajuste ces valeurs selon ton seed data
// ============================================================
const TWILIO_NUMBER = '+3221234567';     // Numéro Twilio configuré dans call_settings
const VIP_PHONE = '+32470111111';         // Numéro dans call_whitelist
const BLOCKED_PHONE = '+32470999999';     // Numéro dans call_blacklist
const RANDOM_PHONE = '+32470555555';      // Numéro lambda
const FORWARD_PHONE = '+32470000001';     // forward_default_phone attendu

let passed = 0, failed = 0;

// ============================================================
// HELPERS
// ============================================================
async function postWebhook(path, body) {
  const params = new URLSearchParams(body);
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  return r.text();
}

async function patchSettings(settings) {
  if (!TOKEN) { console.log('  ⚠️  Pas de TOKEN — skip PATCH settings'); return; }
  const r = await fetch(`${BASE}/api/calls/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify(settings)
  });
  if (!r.ok) console.log('  ⚠️  PATCH settings failed:', await r.text());
}

function check(name, xml, ...conditions) {
  const results = conditions.map(([desc, test]) => {
    const pass = test(xml);
    return { desc, pass };
  });
  const allPass = results.every(r => r.pass);
  if (allPass) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    results.filter(r => !r.pass).forEach(r => console.log(`     → ${r.desc}`));
    failed++;
  }
}

function has(text) { return [text, xml => xml.includes(text)]; }
function hasNot(text) { return [`no "${text}"`, xml => !xml.includes(text)]; }
function hasDial(phone) { return [`<Dial>${phone}`, xml => xml.includes(`<Dial>${phone}</Dial>`)]; }
function hasHangup() { return ['<Hangup/>', xml => xml.includes('<Hangup/>')]; }
function hasRecord() { return ['<Record', xml => xml.includes('<Record')]; }
function hasSay(fragment) { return [`Say: "${fragment}"`, xml => xml.includes(fragment)]; }
function hasReject() { return ['<Reject/>', xml => xml.includes('<Reject/>')]; }

// ============================================================
// TESTS
// ============================================================
async function runTests() {
  console.log('\n🧪 GENDA CALL FILTER — Tests locaux\n');
  console.log(`Base URL: ${BASE}`);
  console.log(`Token: ${TOKEN ? '✅ configuré' : '⚠️  non configuré (skip config changes)'}\n`);

  const callBase = { To: TWILIO_NUMBER, CallSid: 'TEST_' + Date.now() };

  // ----------------------------------------------------------
  // 1. MODE OFF
  // ----------------------------------------------------------
  console.log('📞 MODE OFF');
  if (TOKEN) await patchSettings({ filter_mode: 'off' });
  
  let xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: RANDOM_PHONE });
  check('Appel random → transfert direct', xml,
    hasDial(FORWARD_PHONE),
    hasNot('Hangup')
  );

  // ----------------------------------------------------------
  // 2. MODE SOFT
  // ----------------------------------------------------------
  console.log('\n📞 MODE SOFT');
  if (TOKEN) await patchSettings({ filter_mode: 'soft' });

  xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: RANDOM_PHONE, CallSid: 'TEST_SOFT1' });
  check('Appel random → message + transfert', xml,
    hasSay('bienvenue'),
    hasDial(FORWARD_PHONE),
    hasNot('Hangup')
  );

  xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: VIP_PHONE, CallSid: 'TEST_SOFT_VIP' });
  check('Appel VIP → transfert direct (pas de message)', xml,
    hasDial(FORWARD_PHONE),
    hasNot('bienvenue')
  );

  xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: BLOCKED_PHONE, CallSid: 'TEST_SOFT_BL' });
  check('Appel blacklisté → rejeté', xml,
    hasReject()
  );

  // ----------------------------------------------------------
  // 3. MODE STRICT
  // ----------------------------------------------------------
  console.log('\n📞 MODE STRICT');
  if (TOKEN) await patchSettings({ filter_mode: 'strict', voicemail_enabled: false });

  xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: RANDOM_PHONE, CallSid: 'TEST_STRICT1' });
  check('Appel random → message + goodbye + hangup', xml,
    hasSay('bienvenue'),
    hasSay('Au revoir'),
    hasHangup(),
    hasNot('Dial')
  );

  check('Pas de Gather/DTMF (strict simplifié)', xml,
    hasNot('Gather'),
    hasNot('numDigits')
  );

  // ----------------------------------------------------------
  // 4. STRICT + VOICEMAIL
  // ----------------------------------------------------------
  console.log('\n📞 STRICT + VOICEMAIL');
  if (TOKEN) await patchSettings({ filter_mode: 'strict', voicemail_enabled: true });

  xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: RANDOM_PHONE, CallSid: 'TEST_STRICT_VM' });
  check('Appel → message + Record', xml,
    hasSay('bienvenue'),
    hasSay('message vocal'),
    hasRecord(),
    hasNot('Hangup')
  );

  // ----------------------------------------------------------
  // 5. MODE VACATION
  // ----------------------------------------------------------
  console.log('\n📞 MODE VACATION');
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  if (TOKEN) await patchSettings({
    filter_mode: 'vacation',
    vacation_until: nextWeek,
    vacation_redirect_phone: null,
    vacation_redirect_name: null,
    voicemail_enabled: false
  });

  xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: RANDOM_PHONE, CallSid: 'TEST_VAC1' });
  check('Vacation sans redirect → message + hangup', xml,
    hasSay('fermé'),
    hasHangup(),
    hasNot('Dial')
  );

  // ----------------------------------------------------------
  // 6. VACATION + REDIRECT
  // ----------------------------------------------------------
  console.log('\n📞 VACATION + REDIRECT');
  const REDIRECT_PHONE = '+32470888888';
  if (TOKEN) await patchSettings({
    filter_mode: 'vacation',
    vacation_until: nextWeek,
    vacation_redirect_phone: REDIRECT_PHONE,
    vacation_redirect_name: 'Dr Martin'
  });

  xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: RANDOM_PHONE, CallSid: 'TEST_VAC_RED' });
  check('Vacation avec redirect → message + transfert vers confrère', xml,
    hasSay('fermé'),
    hasSay('Dr Martin'),
    hasDial(REDIRECT_PHONE)
  );

  // ----------------------------------------------------------
  // 7. VACATION + VOICEMAIL (sans redirect)
  // ----------------------------------------------------------
  console.log('\n📞 VACATION + VOICEMAIL');
  if (TOKEN) await patchSettings({
    filter_mode: 'vacation',
    vacation_until: nextWeek,
    vacation_redirect_phone: null,
    voicemail_enabled: true
  });

  xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: RANDOM_PHONE, CallSid: 'TEST_VAC_VM' });
  check('Vacation + voicemail → message + Record', xml,
    hasSay('fermé'),
    hasSay('message vocal'),
    hasRecord(),
    hasNot('Hangup')
  );

  // ----------------------------------------------------------
  // 8. VACATION VIP → toujours transfert
  // ----------------------------------------------------------
  xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: VIP_PHONE, CallSid: 'TEST_VAC_VIP' });
  check('VIP en vacation → transfert direct (pas de message vacation)', xml,
    hasDial(FORWARD_PHONE),
    hasNot('fermé')
  );

  // ----------------------------------------------------------
  // 9. VACATION EXPIRÉE → revient en soft
  // ----------------------------------------------------------
  console.log('\n📞 VACATION EXPIRÉE');
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (TOKEN) await patchSettings({
    filter_mode: 'vacation',
    vacation_until: yesterday
  });

  xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: RANDOM_PHONE, CallSid: 'TEST_VAC_EXP' });
  check('Vacation expirée → fallback soft (message + transfert)', xml,
    hasSay('bienvenue'),
    hasDial(FORWARD_PHONE),
    hasNot('fermé')
  );

  // ----------------------------------------------------------
  // 10. VOICEMAIL CALLBACK
  // ----------------------------------------------------------
  console.log('\n📞 VOICEMAIL CALLBACKS');
  
  xml = await postWebhook('/webhooks/twilio/voicemail/done', {});
  check('Voicemail done → merci + hangup', xml,
    hasSay('Merci'),
    hasHangup()
  );

  // ----------------------------------------------------------
  // 11. CUSTOM MESSAGE
  // ----------------------------------------------------------
  console.log('\n📞 MESSAGES PERSONNALISÉS');
  if (TOKEN) await patchSettings({
    filter_mode: 'strict',
    voicemail_enabled: false,
    custom_message_fr: 'Cabinet du Dr Hakim, merci de réserver en ligne.'
  });

  xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: RANDOM_PHONE, CallSid: 'TEST_CUSTOM' });
  check('Message custom utilisé', xml,
    hasSay('Dr Hakim'),
    hasNot('bienvenue')
  );

  // Reset
  if (TOKEN) await patchSettings({ custom_message_fr: null, filter_mode: 'soft' });

  // ----------------------------------------------------------
  // 12. REPEAT CALLER (simulation)
  // ----------------------------------------------------------
  console.log('\n📞 REPEAT CALLER');
  if (TOKEN) {
    await patchSettings({ filter_mode: 'strict', voicemail_enabled: false, repeat_caller_threshold: 3, repeat_caller_window_min: 15 });
    const repeatPhone = '+32470777777';

    // First 2 calls → strict (message + hangup)
    for (let i = 1; i <= 2; i++) {
      xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: repeatPhone, CallSid: `TEST_REPEAT_${i}` });
    }

    // 3rd call → should transfer (repeat detection)
    xml = await postWebhook('/webhooks/twilio/voice/incoming', { ...callBase, From: repeatPhone, CallSid: 'TEST_REPEAT_3' });
    check('3e appel → transfert (rappel insistant)', xml,
      hasSay('transférons'),
      hasDial(FORWARD_PHONE)
    );
  } else {
    console.log('  ⚠️  Skip (pas de TOKEN)');
  }

  // ----------------------------------------------------------
  // RESULTS
  // ----------------------------------------------------------
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  ✅ ${passed} passés   ❌ ${failed} échoués`);
  console.log(`${'═'.repeat(50)}\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(e => { console.error('Fatal:', e); process.exit(1); });
