-- v54: Update default value propositions to beauty/wellness sector
-- The original defaults were oriented towards accounting/consulting firms

UPDATE value_propositions
SET title = 'Écoute & conseil',
    description = 'Chaque client est unique. Nous prenons le temps de comprendre vos envies pour un résultat sur mesure.',
    icon = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>'
WHERE title = 'Approche personnalisée' AND sort_order = 1;

UPDATE value_propositions
SET title = 'Produits premium',
    description = 'Nous travaillons exclusivement avec des marques professionnelles haut de gamme pour des soins d''exception.',
    icon = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
WHERE title = 'Réactivité' AND sort_order = 2;

UPDATE value_propositions
SET title = 'Hygiène irréprochable',
    description = 'Protocoles stricts de désinfection et matériel stérilisé pour votre sécurité et votre confort.',
    icon = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
WHERE title = 'Expertise reconnue' AND sort_order = 3;

UPDATE value_propositions
SET title = 'Détente & bien-être',
    description = 'Un espace pensé pour votre relaxation, où chaque visite devient un moment rien qu''à vous.',
    icon = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>'
WHERE title = 'Conseils proactifs' AND sort_order = 4;

-- Also update titles that may have been from the seed (with longer versions)
UPDATE value_propositions
SET title = 'Produits premium',
    description = 'Nous travaillons exclusivement avec des marques professionnelles haut de gamme pour des soins d''exception.',
    icon = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
WHERE title = 'Réactivité garantie' AND sort_order = 2;

UPDATE value_propositions
SET title = 'Hygiène irréprochable',
    description = 'Protocoles stricts de désinfection et matériel stérilisé pour votre sécurité et votre confort.',
    icon = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
WHERE title = 'Conformité & rigueur' AND sort_order = 3;
