/**
 * Realisations (portfolio) management
 * All routes require auth + business context
 */
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');
const { checkQuota } = require('../../services/storage-quota');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// List realisations
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT id, title, description, category, image_url, before_url, after_url, sort_order, is_active, created_at
       FROM realisations
       WHERE business_id = $1
       ORDER BY sort_order, created_at DESC`,
      [req.businessId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Create realisation
router.post('/', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { title, description, category, image_url, before_url, after_url } = req.body;
    if (!image_url && !before_url) return res.status(400).json({ error: 'image_url ou before_url requis' });

    const countResult = await queryWithRLS(req.businessId,
      `SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM realisations WHERE business_id = $1`,
      [req.businessId]
    );

    const result = await queryWithRLS(req.businessId,
      `INSERT INTO realisations (business_id, title, description, category, image_url, before_url, after_url, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.businessId, title || null, description || null, category || null, image_url || null, before_url || null, after_url || null, countResult.rows[0].next]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// Update realisation
router.put('/:id', requireAuth, requireOwner, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });
    const { title, description, category, image_url, before_url, after_url, sort_order, is_active } = req.body;
    const result = await queryWithRLS(req.businessId,
      `UPDATE realisations
       SET title = COALESCE($3, title),
           description = COALESCE($4, description),
           category = COALESCE($5, category),
           image_url = COALESCE($6, image_url),
           before_url = COALESCE($7, before_url),
           after_url = COALESCE($8, after_url),
           sort_order = COALESCE($9, sort_order),
           is_active = COALESCE($10, is_active)
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      [req.params.id, req.businessId, title, description, category, image_url, before_url, after_url, sort_order, is_active]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// Upload realisation image (Base64 → disk)
router.post('/upload', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { photo, type, realisation_id } = req.body; // type: 'image', 'before', 'after'
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
    const uploadDir = ensureSubdir('realisations');

    const fileId = require('crypto').randomUUID();
    const filename = `${fileId}.${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), buffer);
    const imageUrl = `/uploads/realisations/${filename}?t=${Date.now()}`;

    // If realisation_id provided, update the appropriate field
    if (realisation_id && UUID_RE.test(realisation_id)) {
      const field = type === 'before' ? 'before_url' : type === 'after' ? 'after_url' : 'image_url';
      await queryWithRLS(req.businessId,
        `UPDATE realisations SET ${field} = $3 WHERE id = $1 AND business_id = $2`,
        [realisation_id, req.businessId, imageUrl]
      );
    }

    res.status(201).json({ image_url: imageUrl });
  } catch (err) { next(err); }
});

// Delete realisation
router.delete('/:id', requireAuth, requireOwner, async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID invalide' });

    const existing = await queryWithRLS(req.businessId,
      `SELECT image_url, before_url, after_url FROM realisations WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );

    // Clean up files
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const { UPLOADS_BASE } = require('../../services/uploads');
      for (const url of [row.image_url, row.before_url, row.after_url]) {
        if (url && url.startsWith('/uploads/realisations/')) {
          const rel = url.split('?')[0].replace(/^\/uploads\//, '');
          const filePath = path.resolve(UPLOADS_BASE, rel);
          if (filePath.startsWith(UPLOADS_BASE)) {
            try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
          }
        }
      }
    }

    await queryWithRLS(req.businessId,
      `DELETE FROM realisations WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
