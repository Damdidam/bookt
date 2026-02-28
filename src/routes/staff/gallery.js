/**
 * Gallery image management
 * All routes require auth + business context
 */
const router = require('express').Router();
const { query } = require('../../services/db');
const { requireAuth, requireRole } = require('../../middleware/auth');

// List gallery images
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, caption, image_url, sort_order, is_active, created_at
       FROM gallery_images
       WHERE business_id = $1
       ORDER BY sort_order, created_at DESC`,
      [req.business_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Create gallery image
router.post('/', requireAuth, requireRole('admin','owner'), async (req, res, next) => {
  try {
    const { title, caption, image_url } = req.body;
    if (!image_url) return res.status(400).json({ error: 'image_url required' });

    // Get next sort_order
    const countResult = await query(
      `SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM gallery_images WHERE business_id = $1`,
      [req.business_id]
    );

    const result = await query(
      `INSERT INTO gallery_images (business_id, title, caption, image_url, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.business_id, title || null, caption || null, image_url, countResult.rows[0].next]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// Update gallery image
router.put('/:id', requireAuth, requireRole('admin','owner'), async (req, res, next) => {
  try {
    const { title, caption, image_url, sort_order, is_active } = req.body;
    const result = await query(
      `UPDATE gallery_images
       SET title = COALESCE($3, title),
           caption = COALESCE($4, caption),
           image_url = COALESCE($5, image_url),
           sort_order = COALESCE($6, sort_order),
           is_active = COALESCE($7, is_active)
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      [req.params.id, req.business_id, title, caption, image_url, sort_order, is_active]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// Delete gallery image
router.delete('/:id', requireAuth, requireRole('admin','owner'), async (req, res, next) => {
  try {
    await query(
      `DELETE FROM gallery_images WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.business_id]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// Reorder gallery images
router.post('/reorder', requireAuth, requireRole('admin','owner'), async (req, res, next) => {
  try {
    const { order } = req.body; // [{id, sort_order}]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

    for (const item of order) {
      await query(
        `UPDATE gallery_images SET sort_order = $3 WHERE id = $1 AND business_id = $2`,
        [item.id, req.business_id, item.sort_order]
      );
    }
    res.json({ reordered: true });
  } catch (err) { next(err); }
});

module.exports = router;
