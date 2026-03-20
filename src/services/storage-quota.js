/**
 * Storage quota management
 * 500 MB per business by default
 */
const fs = require('fs');
const path = require('path');

const QUOTA_BYTES = 500 * 1024 * 1024; // 500 MB
const UPLOADS_BASE = path.resolve(__dirname, '../../public/uploads');

/**
 * Calculate total disk usage for a business across all upload folders
 * Scans gallery and realisations folders for files matching business UUIDs from DB
 */
async function getBusinessUsage(businessId, queryWithRLS) {
  let totalBytes = 0;

  // Get all file URLs from gallery_images
  const gallery = await queryWithRLS(businessId,
    `SELECT image_url FROM gallery_images WHERE business_id = $1`,
    [businessId]
  );

  // Get all file URLs from realisations
  const realisations = await queryWithRLS(businessId,
    `SELECT image_url, before_url, after_url FROM realisations WHERE business_id = $1`,
    [businessId]
  );

  const urls = [];
  gallery.rows.forEach(r => { if (r.image_url) urls.push(r.image_url); });
  realisations.rows.forEach(r => {
    if (r.image_url) urls.push(r.image_url);
    if (r.before_url) urls.push(r.before_url);
    if (r.after_url) urls.push(r.after_url);
  });

  for (const url of urls) {
    if (url && url.startsWith('/uploads/')) {
      const filePath = path.resolve(__dirname, '../../public', url.split('?')[0]);
      if (filePath.startsWith(UPLOADS_BASE)) {
        try {
          const stat = fs.statSync(filePath);
          totalBytes += stat.size;
        } catch (e) { /* file missing, skip */ }
      }
    }
  }

  return totalBytes;
}

/**
 * Check if business can upload a file of given size
 */
async function checkQuota(businessId, fileSizeBytes, queryWithRLS) {
  const used = await getBusinessUsage(businessId, queryWithRLS);
  const remaining = QUOTA_BYTES - used;
  if (fileSizeBytes > remaining) {
    return {
      allowed: false,
      used,
      quota: QUOTA_BYTES,
      remaining,
      message: `Quota dépassé. Utilisé: ${formatBytes(used)} / ${formatBytes(QUOTA_BYTES)}. Libérez de l'espace en supprimant des photos.`
    };
  }
  return { allowed: true, used: used + fileSizeBytes, quota: QUOTA_BYTES, remaining: remaining - fileSizeBytes };
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
  return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
}

module.exports = { getBusinessUsage, checkQuota, QUOTA_BYTES, formatBytes };
