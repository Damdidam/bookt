/**
 * Safe color validator — empêche CSS injection via couleur owner-contrôlée.
 *
 * Les colonnes `practitioners.color`, `services.color`, `service_variants.color`,
 * `tasks.color`, etc. sont owner-saisies sans CHECK DB. Une injection
 * `};display:none` ou `};position:fixed;top:0` peut casser le layout ou
 * masquer un bouton critique.
 *
 * Pattern accepté :
 *   - `#rgb`, `#rrggbb`, `#rrggbbaa` (3-8 hex)
 *   - `var(--token)` avec [a-zA-Z0-9_-] dans le token
 *   - Nom CSS simple (red, blue, transparent, inherit)
 *
 * Rejette : `rgb()`, `hsl()`, functions, espaces, `;`, `}`, etc.
 * Si la valeur fail, retourne `fallback` (défaut = `var(--primary)`).
 *
 * Usage :
 *   import { safeColor } from '../utils/safe-color.js';
 *   style="background:${safeColor(p.color)}"
 */

const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|var\(--[a-zA-Z0-9_-]+\)|[a-zA-Z]+)$/;

export function safeColor(value, fallback = 'var(--primary)') {
  if (!value || typeof value !== 'string') return fallback;
  return SAFE_COLOR_RE.test(value) ? value : fallback;
}
