/**
 * Billit webhook — reçoit les events de status des factures Peppol.
 * Billit POST { invoiceId, event, detail } avec header X-Billit-Signature (HMAC SHA256).
 *
 * Le body DOIT être lu en raw (Buffer) pour valider le HMAC — on utilise
 * express.raw() local sur cette route au lieu de express.json() global.
 */
const router = require('express').Router();
const express = require('express');
const peppol = require('../../services/peppol');

router.post('/', express.raw({ type: 'application/json', limit: '100kb' }), async (req, res) => {
  try {
    const rawBody = req.body ? req.body.toString('utf8') : '';
    const signature = req.headers['x-billit-signature'] || req.headers['x-signature'] || '';
    const result = await peppol.handleWebhook(rawBody, signature);
    if (!result.ok) {
      console.warn('[BILLIT WH] rejected:', result.reason, 'from IP', req.ip);
      return res.status(result.reason === 'invalid_signature' ? 403 : 400).json({ error: result.reason });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[BILLIT WH] handler error:', err.message);
    res.status(500).json({ error: 'internal' });
  }
});

module.exports = router;
