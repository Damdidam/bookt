/**
 * Phone normalization to E.164 for BE/FR/LU.
 * Stays dependency-free: minimal logic for the 3 supported countries.
 *
 * - "+32 491 23 45 67" → "+32491234567"
 * - "0491 23 45 67"   → "+32491234567" (default BE)
 * - "06 12 34 56 78"  → "+33612345678" if defaultCountry='FR'
 * - "0032 491..."     → "+32491..."
 *
 * Returns null if the number cannot be normalized.
 */
// Per-country expected total length (E.164, no '+'). Mobiles in BE/FR/LU are 11 digits total.
// BE: 32 + 9 (4XX XX XX XX) → 11. FR: 33 + 9 → 11. LU: 352 + 6-9 → 9-12.
const COUNTRY_LENGTHS = {
  BE: { min: 11, max: 11 },
  FR: { min: 11, max: 11 },
  LU: { min: 9,  max: 12 }
};

function normalizeE164(raw, defaultCountry = 'BE') {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Strip everything except digits and leading '+'
  s = s.replace(/[^\d+]/g, '');
  if (!s) return null;

  // Convert "00XX..." → "+XX..." (international prefix)
  if (s.startsWith('00')) s = '+' + s.slice(2);

  // Already E.164: validate per-country length when prefix matches
  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (digits.length < 8 || digits.length > 15) return null;
    // R3 fix: enforce minimum total length per country (rejects truncated numbers like +32123456)
    for (const [country, range] of Object.entries(COUNTRY_LENGTHS)) {
      const cc = ({ BE: '32', FR: '33', LU: '352' })[country];
      if (digits.startsWith(cc) && (digits.length < range.min || digits.length > range.max)) return null;
    }
    return s;
  }

  // National form starting with '0' → strip and prepend country
  if (s.startsWith('0')) s = s.slice(1);

  const prefixByCountry = { BE: '32', FR: '33', LU: '352' };
  const prefix = prefixByCountry[defaultCountry] || prefixByCountry.BE;
  const digits = prefix + s;
  if (digits.length < 8 || digits.length > 15) return null;
  // R3 fix: per-country minimum length to reject truncated mobiles
  const range = COUNTRY_LENGTHS[defaultCountry];
  if (range && (digits.length < range.min || digits.length > range.max)) return null;
  return '+' + digits;
}

module.exports = { normalizeE164 };
