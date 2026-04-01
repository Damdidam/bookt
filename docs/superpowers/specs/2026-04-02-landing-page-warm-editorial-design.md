# Landing Page Redesign — Warm Editorial

**Date :** 2026-04-02
**Objectif :** Refaire le design de la page publique `index.html` (genda.be) pour éliminer l'aspect "template IA générique" tout en gardant le même contenu et les mêmes sections.
**Direction :** Warm Editorial — chaleureux + bold, typographie expressive, layouts asymétriques, palette naturelle.

---

## 1. Palette de couleurs

Remplace l'ensemble des CSS variables actuelles.

| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#FAF7F2` | Fond principal (crème chaud) |
| `--surface` | `#F0EBE3` | Surfaces secondaires |
| `--surface-2` | `#E8E2D8` | Surfaces tertiaires |
| `--white` | `#FFFFFF` | Cartes, éléments surélevés |
| `--text` | `#1E1B18` | Texte principal (noir chaud) |
| `--text-2` | `#3D3833` | Texte secondaire |
| `--text-3` | `#6B6560` | Texte tertiaire |
| `--text-4` | `#9A9490` | Texte désactivé/labels |
| `--accent` | `#C05A3C` | Terracotta profond (CTAs, liens, accents) |
| `--accent-dark` | `#A04830` | Terracotta hover |
| `--accent-light` | `#FDF0EC` | Fond terracotta léger |
| `--accent-glow` | `rgba(192,90,60,0.2)` | Shadow glow |
| `--sage` | `#5B7F5E` | Vert sauge (accent secondaire) |
| `--sage-bg` | `#EEF4EF` | Fond sage léger |
| `--amber` | `#D4944C` | Ambre doré (highlights) |
| `--amber-bg` | `#FBF5ED` | Fond ambre léger |
| `--green` | `#3A9E5C` | Succès (inchangé) |
| `--green-bg` | `#EEFAF1` | Fond succès |
| `--red` | `#DC4444` | Erreur (inchangé) |
| `--red-bg` | `#FEF1F1` | Fond erreur |
| `--teal` | `#0D7377` | Praticien B (inchangé dans les démos) |
| `--teal-bg` | `#EDF7F7` | Fond teal |
| `--purple` | `#7C5CDB` | Accent purple (inchangé) |
| `--purple-bg` | `#F3F0FE` | Fond purple |
| `--gold` | `#C9A84C` | Temps de pose (inchangé dans les démos) |
| `--gold-bg` | `#FBF7ED` | Fond gold |

Les couleurs fonctionnelles (green, red, teal, purple, gold) restent identiques car elles sont utilisées dans les démos timeline du moteur qui ne changent pas.

## 2. Typographie

| Token | Valeur | Usage |
|---|---|---|
| `--serif` | `'Fraunces', Georgia, serif` | Titres, nombres, accents éditoriaux |
| `--sans` | `'Plus Jakarta Sans', -apple-system, sans-serif` | Corps, UI, labels |

**Google Fonts import :**
```
Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,600;0,9..144,700;0,9..144,800;1,9..144,400;1,9..144,600&display=swap
Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap
```

**Tailles :**
- Hero h1 : `clamp(2.8rem, 5vw, 4.2rem)`, font-weight 700
- Section titles : `clamp(2rem, 3.5vw, 2.8rem)`, font-weight 600
- Section labels : Fraunces italic 1rem au lieu de uppercase 0.68rem letter-spacing
- Body : 1rem / line-height 1.7
- Small/pills : 0.78rem

## 3. Navigation

- Hauteur : 72px (au lieu de 64px)
- Logo wordmark "Genda" en Fraunces font-weight 600
- Liens nav : pas de background au hover, juste un underline animé (pseudo-element `::after` avec width 0→100%, height 2px, background terracotta, transition 0.3s)
- CTA "Essai gratuit" : border-radius 12px, padding 10px 24px, background `--accent`
- Mobile : overlay plein écran (100vh, fond `--bg`, liens centrés en Fraunces 1.5rem, CTA en bas)

## 4. Hero

**Layout :** Centré, single-column (pas de grid 2 colonnes).

```
[badge]
[h1 centré — Fraunces 700, mot clé en italic terracotta]
[sous-titre centré, max-width 600px]
[2 CTA côte à côte, centrés]
[proof points en ligne, séparés par · ]
[mockup calendrier en dessous, max-width 800px, transform rotate(-1deg), shadow-lg]
  [floating cards avec légère rotation aléatoire ±2deg]
```

- Badge "Nouveau" : fond `--sage`, color white, border-radius 100px, pas de pulse-dot
- Proof points : texte simple séparé par `·`, pas de checkmarks vertes
- Mockup : même contenu, mais posé avec `transform: rotate(-1deg)`, `box-shadow: 0 24px 80px rgba(0,0,0,0.12)`
- Floating cards : ajout de `transform: rotate(2deg)` sur hf1, `rotate(-1.5deg)` sur hf2

## 5. Sectors

- Pas de fond `--surface`, juste `border-top` et `border-bottom` de 1px `--border`
- Label "Pour tous les pros" : Fraunces italic, pas d'uppercase, pas de letter-spacing
- Chips : ajout d'une micro-icône SVG (14x14) à gauche du texte dans chaque tag
  - Coiffure → ciseaux, Esthétique → diamant, Barbier → lame, Massage → main, Onglerie → main vernis, Bien-être → lotus, Tatouage → aiguille, Médecine esthétique → seringue, Physiothérapie → corps
- Hover : fond `--accent-light`, border-color `--accent`, color `--accent-dark`

## 6. Pain Points

- Grille : `grid-template-columns: repeat(3, 1fr)` première ligne, `repeat(2, 1fr)` deuxième ligne centrée (ou `repeat(auto-fit, minmax(280px, 1fr))` pour simplifier)
- Chaque carte : `border-left: 3px solid` (couleur de l'icône correspondante)
- Icônes : `border-radius: 60% 40% 55% 45% / 50% 60% 40% 50%` (forme blob organique)
- Titre de section : Fraunces italic au lieu du label uppercase

## 7. Engine Showcase (dark)

- Fond : `#1E1B18`
- Texture grain : pseudo-element `::after` avec un SVG noise filter, opacity 0.03, pointer-events none
- Numéros 01-04 : Fraunces 5rem, opacity 0.08, position absolute top 16px right 24px dans chaque carte
- Cartes : pas de border visible. Hover → fond `rgba(255,255,255,0.04)` + `border-bottom: 3px solid var(--accent)` animé (width 0→100%)
- Pills : fond `rgba(91,127,94,0.12)` (sage transparent), border `rgba(91,127,94,0.2)`
- Les démos timeline (ed-row, ed-block, etc.) restent **identiques** — c'est du contenu spécifique qui fonctionne bien

## 8. Stats Bar

- Fond : `--accent` (terracotta)
- Bords haut et bas : SVG wave path au lieu de lignes droites. Forme simple avec 1-2 ondulations
- Chiffres : Fraunces 3rem, color white
- Labels : Plus Jakarta Sans 300, rgba(255,255,255,0.7)

## 9. Bento Features

- Gap : 24px (au lieu de 16px)
- Cartes hover : pas de translateY. Hover → `border-left: 4px solid [couleur icône]` (transition 0.2s), fond très légèrement teinté
- Icônes : border-radius blob comme pain points
- Pills : border-radius asymétrique `12px 8px 12px 4px`, fond légèrement teinté par la couleur de la carte
- Cartes `span2` : layout interne flex avec texte (flex 1) et pills (flex-wrap, align-self flex-start) côte à côte

## 10. Anti-Marketplace

- Même fond dark `#1E1B18` + texture grain
- ✕ et ✓ remplacés par des SVG inline (X-circle et check-circle) stylisés, pas des caractères texte
- Icônes : 32x32, stroke-width 2

## 11. Feature Blocks

- Layout alterné identique (grid 2 colonnes, `.reverse`)
- Les visuels (phone, dashboard) reçoivent un **blob décoratif** en arrière-plan : pseudo-element avec `border-radius: 60% 40% 55% 45%`, fond `--sage-bg` ou `--amber-bg`, `z-index: -1`, légèrement décalé et plus grand que le visuel
- Le mockup phone et dashboard gardent leur contenu identique

## 12. Pricing

- Cartes : border-radius 20px
- Plan recommandé ("Le plus populaire") : fond `--accent-light`, border complète `2px solid var(--accent)` au lieu du petit badge flottant
- Le badge "Le plus populaire" reste mais devient un chip intégré en haut de la carte (pas en position absolute)
- Boutons : border-radius 12px

## 13. FAQ

- Toggle icon : `+` / `−` en Fraunces 1.5rem au lieu de chevrons SVG
- Animation : la réponse s'ouvre avec `max-height` transition (0 → auto via JS) au lieu de display none/block
- Séparateurs : `border-bottom: 1px dashed var(--border)` au lieu de solid

## 14. CTA Final

- Fond : `--accent` uni (pas de gradient)
- Texture grain overlay (comme sections dark)
- En arrière-plan : un texte décoratif en Fraunces italic 6rem, opacity 0.05, rotation -5deg ("Réservez")
- Le bouton blanc garde son style, border-radius 12px

## 15. Footer

- Plus aéré : padding 64px 32px
- Logo "Genda" en Fraunces
- Links en Plus Jakarta Sans
- Séparation bottom : `border-top: 1px dashed var(--border)`

## 16. Animations

- **Scroll reveal :** On garde `.rv` / `.vis` mais le translateY passe de 36px à 24px, transition plus douce (0.6s au lieu de 0.8s)
- **Hover underline nav :** `::after` pseudo-element, width 0→100%, transition 0.3s ease
- **Hover cartes :** border-left width transition, pas de translateY
- **Stats wave :** SVG statique, pas d'animation
- **FAQ toggle :** max-height transition 0.4s ease
- **On supprime :** `float` keyframe sur les hero floating cards (elles sont juste positionnées avec rotation statique)
- **On garde :** `fadeUp` pour le hero, shimmer pour les loaders

## 17. Responsive

Les breakpoints restent identiques (900px, 640px). Changements spécifiques :

**≤ 900px :**
- Hero : padding-top réduit à 110px
- Pain grid : `repeat(2, 1fr)` puis 1 centrée
- Le reste identique à l'actuel

**≤ 640px :**
- Hero h1 : min clamp de 2.2rem
- Nav mobile : overlay plein écran au lieu de dropdown (à implémenter)
- Stats wave : les SVG waves se simplifient (moins d'ondulations)
- Le reste identique à l'actuel

## 18. Ce qui ne change PAS

- Le contenu texte (titres, descriptions, labels, proof points, FAQ, pricing)
- Les sections et leur ordre
- Les démos timeline dans engine showcase (ed-row, ed-block, etc.)
- Les mockups phone/dashboard (contenu interne)
- Le JavaScript (scroll reveal, FAQ toggle, nav scroll state)
- Les couleurs fonctionnelles dans les démos (teal, gold, green pour les timelines)
- La structure HTML globale (sections, classes utilitaires)

## 19. Fichiers impactés

| Fichier | Changement |
|---|---|
| `public/index.html` | CSS complet (variables, styles), Google Fonts link, micro-icônes SVG sectors, SVG waves stats, hero layout restructuré, nav mobile overlay |

C'est un fichier unique, CSS inline. Pas d'autres fichiers impactés.
