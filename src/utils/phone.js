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
function normalizeE164(raw, defaultCountry = 'BE') {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Strip everything except digits and leading '+'
  s = s.replace(/[^\d+]/g, '');
  if (!s) return null;

  // Convert "00XX..." → "+XX..." (international prefix)
  if (s.startsWith('00')) s = '+' + s.slice(2);

  // Already E.164: validate length and return
  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (digits.length < 8 || digits.length > 15) return null;
    return s;
  }

  // National form starting with '0' → strip and prepend country
  if (s.startsWith('0')) s = s.slice(1);

  const prefixByCountry = { BE: '32', FR: '33', LU: '352' };
  const prefix = prefixByCountry[defaultCountry] || prefixByCountry.BE;
  const digits = prefix + s;
  if (digits.length < 8 || digits.length > 15) return null;
  return '+' + digits;
}

module.exports = { normalizeE164 };
