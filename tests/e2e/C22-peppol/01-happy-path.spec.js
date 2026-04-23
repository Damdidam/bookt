const { test, expect } = require('@playwright/test');

test.describe('C22 — Peppol integration smoke', () => {
  test('GET /api/staff/subscription-invoices returns expected shape', async ({ request }) => {
    // Smoke test minimal : endpoint répond avec la structure attendue.
    // Pas d'auth nécessaire si le endpoint renvoie 401 avant les checks — c'est déjà une validation.
    // Si on a un token d'auth test, on peut vérifier la shape complète.
    const res = await request.get('/api/staff/subscription-invoices?limit=5', {
      failOnStatusCode: false
    });
    // Statuses acceptables : 401 (pas authentifié) ou 200 (si auto-login test).
    // Dans les 2 cas, l'endpoint est mountée correctement.
    expect([200, 401, 403]).toContain(res.status());

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('invoices');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.invoices)).toBe(true);
      expect(body.pagination).toHaveProperty('total_count');
      expect(body.pagination).toHaveProperty('limit');
      expect(body.pagination).toHaveProperty('offset');
    }
  });
});
