/**
 * News posts management (simple actus for mini-site)
 * All routes require auth + business context
 */
const router = require('express').Router();
const { query } = require('../../services/db');
const { requireAuth, requireRole } = require('../../middleware/auth');

// List news posts
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, content, tag, tag_type, image_url, published_at, is_active, created_at
       FROM news_posts
       WHERE business_id = $1
       ORDER BY published_at DESC, created_at DESC`,
      [req.business_id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Create news post
router.post('/', requireAuth, requireRole('admin','owner'), async (req, res, next) => {
  try {
    const { title, content, tag, tag_type, image_url, published_at } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content required' });

    const result = await query(
      `INSERT INTO news_posts (business_id, title, content, tag, tag_type, image_url, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.business_id, title, content, tag || null, tag_type || 'info', image_url || null, published_at || new Date()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// Update news post
router.put('/:id', requireAuth, requireRole('admin','owner'), async (req, res, next) => {
  try {
    const { title, content, tag, tag_type, image_url, published_at, is_active } = req.body;
    const result = await query(
      `UPDATE news_posts
       SET title = COALESCE($3, title),
           content = COALESCE($4, content),
           tag = COALESCE($5, tag),
           tag_type = COALESCE($6, tag_type),
           image_url = COALESCE($7, image_url),
           published_at = COALESCE($8, published_at),
           is_active = COALESCE($9, is_active)
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      [req.params.id, req.business_id, title, content, tag, tag_type, image_url, published_at, is_active]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// Delete news post
router.delete('/:id', requireAuth, requireRole('admin','owner'), async (req, res, next) => {
  try {
    await query(
      `DELETE FROM news_posts WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.business_id]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
