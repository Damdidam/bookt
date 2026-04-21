/**
 * Image magic-bytes validation — vérifie que le contenu binaire correspond
 * bien à un format image connu (JPEG/PNG/WebP), pas juste le MIME prefix
 * du data URI (qui est contrôlé par l'attaquant).
 *
 * Sans cette validation, attaquant peut uploader du HTML/JS/SVG malicieux
 * avec extension `.png` → servi depuis `/uploads/*` → risque XSS via SVG
 * ou stockage arbitraire (content-type sniffing côté browser).
 *
 * Signatures officielles :
 * - JPEG : FF D8 FF
 * - PNG : 89 50 4E 47 0D 0A 1A 0A
 * - WebP : RIFF <4 bytes size> WEBP
 *
 * Accepte un Buffer brut et retourne le type détecté ou null.
 *
 * @param {Buffer} buffer - contenu binaire du fichier
 * @returns {'jpeg'|'png'|'webp'|null}
 */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  // JPEG : FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';
  // PNG : 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
  ) return 'png';
  // WebP : "RIFF" ... "WEBP"
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'webp';
  return null;
}

/**
 * Parse un data URI base64 + valide magic bytes + retourne le type + buffer.
 *
 * @param {string} dataUri - "data:image/jpeg;base64,..."
 * @returns {{ buffer: Buffer, type: 'jpeg'|'png'|'webp' } | null} null si invalide
 */
function parseAndValidateImageDataUri(dataUri) {
  if (typeof dataUri !== 'string') return null;
  const match = dataUri.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
  if (!match) return null;
  let buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch (_) { return null; }
  if (buffer.length === 0) return null;
  const detected = detectImageType(buffer);
  if (!detected) return null;
  // Le type MIME déclaré doit correspondre au type détecté.
  const declared = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
  if (declared !== detected) return null;
  return { buffer, type: detected };
}

module.exports = { detectImageType, parseAndValidateImageDataUri };
