/**
 * Gallery image management
 * All routes require auth + business context
 */
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { queryWithRLS, transactionWithRLS } = require('../../services/db');
const { requireAuth, requireOwner, blockIfImpersonated } = require('../../middleware/auth');
const { checkQuota, getBusinessUsage, QUOTA_BYTES, formatBytes } = require('../../services/storage-quota');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Storage quota
router.get('/quota', requireAuth, async (req, res, next) => {
  try {
    const used = await getBusinessUsage(req.businessId, queryWithRLS);
    res.json({ used, quota: QUOTA_BYTES, remaining: QUOTA_BYTES - used, used_formatted: formatBytes(used), quota_formatted: formatBytes(QUOTA_BYTES), remaining_formatted: formatBytes(QUOTA_BYTES - used), percent: Math.round((used / QUOTA_BYTES) * 100) });
  } catch (err) { next(err); }
});

// List gallery images
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT id, title, caption, image_url, sort_order, is_active, created_at
       FROM gallery_images
       WHERE business_id = $1
       ORDER BY sort_order, created_at DESC`,
      [req.businessId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Create gallery image
router.post('/', requireAuth, requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const { title, caption, image_url } = req.body;
    if (!image_url) return res.status(400).json({ error: 'image_url required' });

    // Get next sort_order
    const countResult = await queryWithRLS(req.businessId,
      `SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM gallery_images WHERE business_id = $1`,
      [req.businessId]
    );

    const result = await queryWithRLS(req.businessId,
      `INSERT INTO gallery_images (business_id, title, caption, image_url, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.businessId, title || null, caption || null, image_url, countResult.rows[0].next]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// Update gallery image
router.put('/:id', requireAuth, requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { title, caption, image_url, sort_order, is_active } = req.body;
    const result = await queryWithRLS(req.businessId,
      `UPDATE gallery_images
       SET title = COALESCE($3, title),
           caption = COALESCE($4, caption),
           image_url = COALESCE($5, image_url),
           sort_order = COALESCE($6, sort_order),
           is_active = COALESCE($7, is_active)
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      [req.params.id, req.businessId, title, caption, image_url, sort_order, is_active]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// Upload gallery image (Base64 → disk)
router.post('/upload', requireAuth, requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const { photo, title, caption } = req.body;
    if (!photo) return res.status(400).json({ error: 'Photo requise' });

    const match = photo.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Format invalide (JPEG, PNG ou WebP requis)' });

    const ext = match[1] === 'jpg' ? 'jpeg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');

    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Photo trop lourde (max 2 Mo)' });
    }

    // Check storage quota
    const quota = await checkQuota(req.businessId, buffer.length, queryWithRLS);
    if (!quota.allowed) return res.status(413).json({ error: quota.message });

    const { ensureSubdir } = require('../../services/uploads');
    const uploadDir = ensureSubdir('gallery');

    // Get next sort_order
    const countResult = await queryWithRLS(req.businessId,
      `SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM gallery_images WHERE business_id = $1`,
      [req.businessId]
    );

    // Insert first to get the UUID
    const result = await queryWithRLS(req.businessId,
      `INSERT INTO gallery_images (business_id, title, caption, image_url, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.businessId, title || null, caption || null, 'pending', countResult.rows[0].next]
    );

    const imgId = result.rows[0].id;
    const filename = `${imgId}.${ext}`;
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Nom de fichier invalide' });
    }

    fs.writeFileSync(path.join(uploadDir, filename), buffer);
    const imageUrl = `/uploads/gallery/${filename}?t=${Date.now()}`;

    await queryWithRLS(req.businessId,
      `UPDATE gallery_images SET image_url = $3 WHERE id = $1 AND business_id = $2`,
      [imgId, req.businessId, imageUrl]
    );

    result.rows[0].image_url = imageUrl;
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// Delete gallery image
router.delete('/:id', requireAuth, requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });

    // Clean up file if it's a local upload
    const existing = await queryWithRLS(req.businessId,
      `SELECT image_url FROM gallery_images WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    if (existing.rows[0]?.image_url?.startsWith('/uploads/gallery/')) {
      const { UPLOADS_BASE } = require('../../services/uploads');
      const rel = existing.rows[0].image_url.split('?')[0].replace(/^\/uploads\//, '');
      const filePath = path.resolve(UPLOADS_BASE, rel);
      if (filePath.startsWith(UPLOADS_BASE)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    }

    await queryWithRLS(req.businessId,
      `DELETE FROM gallery_images WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// Reorder gallery images
router.post('/reorder', requireAuth, requireOwner, blockIfImpersonated, async (req, res, next) => {
  try {
    const { order } = req.body; // [{id, sort_order}]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

    // Validate each item has a valid id and numeric sort_order
    for (const item of order) {
      if (!item.id || !UUID_RE.test(item.id) || typeof item.sort_order !== 'number' || !Number.isInteger(item.sort_order)) {
        return res.status(400).json({ error: 'Each item must have a valid UUID id and integer sort_order' });
      }
    }

    await transactionWithRLS(req.businessId, async (client) => {
      for (const item of order) {
        await client.query(
          `UPDATE gallery_images SET sort_order = $3 WHERE id = $1 AND business_id = $2`,
          [item.id, req.businessId, item.sort_order]
        );
      }
    });
    res.json({ reordered: true });
  } catch (err) { next(err); }
});

module.exports = router;
