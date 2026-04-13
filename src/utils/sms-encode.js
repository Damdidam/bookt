/**
 * Convert SMS body characters to the GSM-7 default alphabet so Twilio bills
 * 160 chars/segment instead of 70 chars/segment (UCS-2).
 *
 * Handles: em-dash → -, en-dash → -, smart quotes → straight, accented
 * Latin → ASCII (NFD strip), ellipsis → "...", non-breaking space → " ".
 *
 * Caveat: this lossily strips diacritics ("réservé" → "reserve"). Acceptable
 * for SMS text where readability beats orthography. Email content is unaffected.
 */
const REPLACEMENTS = {
  '\u2014': '-',  // em dash
  '\u2013': '-',  // en dash
  '\u2018': "'",  // left single quote
  '\u2019': "'",  // right single quote
  '\u201c': '"',  // left double quote
  '\u201d': '"',  // right double quote
  '\u2026': '...',// ellipsis
  '\u00a0': ' ',  // non-breaking space
  '\u202f': ' ',  // narrow nbsp
  '\u20ac': 'EUR', // €  — covered by extension table but eats 2 chars; "EUR" is safer for length budget
  '\u00ab': '"',   // « guillemet français
  '\u00bb': '"'    // » guillemet français
};

function toGsm7(text) {
  if (!text) return text;
  let s = String(text);
  for (const [from, to] of Object.entries(REPLACEMENTS)) {
    s = s.split(from).join(to);
  }
  // Strip diacritics: NFD decompose then drop combining marks
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s;
}

module.exports = { toGsm7 };
