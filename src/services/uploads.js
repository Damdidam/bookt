/**
 * Single source of truth for upload storage paths.
 *
 * Default (dev / legacy): public/uploads — ephemeral on Render, files vanish on redeploy.
 * Production fix: mount a Render Disk (or equivalent persistent volume) and set
 *     UPLOADS_DIR=/var/data/uploads
 * so every upload (logo, cover, practitioner photos, realisations, gallery, quote attachments)
 * survives deploys. server.js exposes /uploads/* as a static route pointing at UPLOADS_BASE,
 * so URLs like /uploads/branding/<file> keep working from any location.
 */
const path = require('path');
const fs = require('fs');

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(__dirname, '../../public/uploads');

// Ensure the base directory exists at module load — fs.writeFileSync later assumes it's there.
try { fs.mkdirSync(UPLOADS_BASE, { recursive: true }); } catch (_) { /* ignore race */ }

function ensureSubdir(subdir) {
  const dir = path.join(UPLOADS_BASE, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { UPLOADS_BASE, ensureSubdir };
