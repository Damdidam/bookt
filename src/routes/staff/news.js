/**
 * News posts management (simple actus for mini-site)
 * All routes require auth + business context
 */
const router = require('express').Router();
const { queryWithRLS } = require('../../services/db');
const { requireAuth, requireOwner } = require('../../middleware/auth');

// List news posts
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await queryWithRLS(req.businessId,
      `SELECT id, title, content, tag, tag_type, image_url, published_at, is_active, created_at
       FROM news_posts
       WHERE business_id = $1
       ORDER BY published_at DESC, created_at DESC`,
      [req.businessId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Create news post
router.post('/', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { title, content, tag, tag_type, image_url, published_at } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content required' });

    const result = await queryWithRLS(req.businessId,
      `INSERT INTO news_posts (business_id, title, content, tag, tag_type, image_url, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.businessId, title, content, tag || null, tag_type || 'info', image_url || null, published_at || new Date()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// Update news post
router.put('/:id', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { title, content, tag, tag_type, image_url, published_at, is_active } = req.body;

    // Build dynamic SET to allow resetting tag/tag_type to null
    const sets = [];
    const params = [req.params.id, req.businessId];
    let idx = 3;

    if (title !== undefined) { sets.push(`title = $${idx}`); params.push(title); idx++; }
    else { sets.push(`title = title`); }

    if (content !== undefined) { sets.push(`content = $${idx}`); params.push(content); idx++; }
    else { sets.push(`content = content`); }

    // tag and tag_type: if present in body (even null), update; otherwise keep
    if ('tag' in req.body) { sets.push(`tag = $${idx}`); params.push(tag); idx++; }
    if ('tag_type' in req.body) { sets.push(`tag_type = $${idx}`); params.push(tag_type); idx++; }

    if (image_url !== undefined) { sets.push(`image_url = $${idx}`); params.push(image_url); idx++; }
    if (published_at !== undefined) { sets.push(`published_at = $${idx}`); params.push(published_at); idx++; }
    if (is_active !== undefined) { sets.push(`is_active = $${idx}`); params.push(is_active); idx++; }

    // V13-028: Always update updated_at
    sets.push('updated_at = NOW()');

    const result = await queryWithRLS(req.businessId,
      `UPDATE news_posts SET ${sets.join(', ')}
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// Delete news post
router.delete('/:id', requireAuth, requireOwner, async (req, res, next) => {
  try {
    await queryWithRLS(req.businessId,
      `DELETE FROM news_posts WHERE id = $1 AND business_id = $2`,
      [req.params.id, req.businessId]
    );
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
