/**
 * Unit tests : src/services/image-validation.js
 * Pas de DB / Stripe required. Exécution : `node tests/unit-image-validation.test.js`
 */
const { detectImageType, parseAndValidateImageDataUri } = require('../src/services/image-validation');

function assert(cond, msg) {
  if (!cond) { console.error('✗ FAIL:', msg); process.exit(1); }
}

// Valid magic bytes — minimum 12 bytes pour couvrir WebP.
const JPEG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x00]);
const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

// --- detectImageType ---
assert(detectImageType(JPEG_BYTES) === 'jpeg', 'JPEG detected');
assert(detectImageType(PNG_BYTES) === 'png', 'PNG detected');
assert(detectImageType(WEBP_BYTES) === 'webp', 'WebP detected');

// Refus signatures malformées
assert(detectImageType(Buffer.from([0x00, 0x00, 0x00])) === null, 'Empty-ish rejected');
assert(detectImageType(Buffer.from([0xFF, 0xD8])) === null, 'Short buffer rejected');
assert(detectImageType(Buffer.from('hello world stuff here')) === null, 'Text rejected');
assert(detectImageType('not a buffer') === null, 'String rejected');
assert(detectImageType(null) === null, 'null rejected');
assert(detectImageType(undefined) === null, 'undefined rejected');

// GIF non-supporté
const GIF_BYTES = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
assert(detectImageType(GIF_BYTES) === null, 'GIF not supported');

console.log('✓ detectImageType — 9 tests OK');

// --- parseAndValidateImageDataUri ---
const jpegUri = 'data:image/jpeg;base64,' + JPEG_BYTES.toString('base64');
const pngUri = 'data:image/png;base64,' + PNG_BYTES.toString('base64');
const webpUri = 'data:image/webp;base64,' + WEBP_BYTES.toString('base64');

const r1 = parseAndValidateImageDataUri(jpegUri);
assert(r1 && r1.type === 'jpeg' && r1.buffer.equals(JPEG_BYTES), 'JPEG uri parsed');

const r2 = parseAndValidateImageDataUri(pngUri);
assert(r2 && r2.type === 'png' && r2.buffer.equals(PNG_BYTES), 'PNG uri parsed');

const r3 = parseAndValidateImageDataUri(webpUri);
assert(r3 && r3.type === 'webp' && r3.buffer.equals(WEBP_BYTES), 'WebP uri parsed');

// jpg alias → jpeg
const jpgAlias = 'data:image/jpg;base64,' + JPEG_BYTES.toString('base64');
const r4 = parseAndValidateImageDataUri(jpgAlias);
assert(r4 && r4.type === 'jpeg', 'jpg alias → jpeg');

// MIME mismatch : déclare PNG mais binaire JPEG → rejet
const mismatchUri = 'data:image/png;base64,' + JPEG_BYTES.toString('base64');
assert(parseAndValidateImageDataUri(mismatchUri) === null, 'MIME/binary mismatch rejected');

// Exploit : data:image/png avec payload HTML → magic bytes fail → null
const htmlPayload = Buffer.from('<html><script>alert(1)</script></html>');
const xssUri = 'data:image/png;base64,' + htmlPayload.toString('base64');
assert(parseAndValidateImageDataUri(xssUri) === null, 'HTML payload rejected (XSS block)');

// Format non-whitelist (gif/heic/avif)
const gifUri = 'data:image/gif;base64,' + GIF_BYTES.toString('base64');
assert(parseAndValidateImageDataUri(gifUri) === null, 'GIF uri rejected (not whitelisted)');
assert(parseAndValidateImageDataUri('data:image/heic;base64,xxx') === null, 'HEIC rejected');
assert(parseAndValidateImageDataUri('data:image/avif;base64,xxx') === null, 'AVIF rejected');

// Invalid inputs
assert(parseAndValidateImageDataUri(null) === null, 'null rejected');
assert(parseAndValidateImageDataUri(undefined) === null, 'undefined rejected');
assert(parseAndValidateImageDataUri('') === null, 'empty string rejected');
assert(parseAndValidateImageDataUri('not a data uri') === null, 'garbage rejected');
assert(parseAndValidateImageDataUri('data:image/jpeg;base64,') === null, 'empty base64 rejected');
assert(parseAndValidateImageDataUri(42) === null, 'number rejected');

// Case-insensitive MIME
const upperCase = 'data:IMAGE/JPEG;base64,' + JPEG_BYTES.toString('base64');
const r5 = parseAndValidateImageDataUri(upperCase);
assert(r5 && r5.type === 'jpeg', 'case-insensitive MIME');

console.log('✓ parseAndValidateImageDataUri — 14 tests OK');

console.log('\n✓ image-validation.js unit tests PASS (23 assertions)');
process.exit(0);
