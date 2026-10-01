# Fiche Chrome Web Store : WikiRemastered

Tout ce qu’il faut pour remplir la fiche dans le [tableau de bord développeur](https://chrome.google.com/webstore/devconsole), dans l’ordre des onglets.

## Nouvel examen (version 1.33.2)

Dans le [tableau de bord développeur](https://chrome.google.com/webstore/devconsole), sur la fiche de WikiRemastered :

1. **Paquet** › **Importer un nouveau paquet** : `dist/WikiRemastered-1.33.2-chrome-web-store.zip` (produit par `python3 scripts/package.py`). La version doit être plus élevée que le dernier envoi : 1.33.2 convient, qu’un envoi 1.32.0, 1.33.0 ou 1.33.1 ait eu lieu ou non.
2. **Fiche Play Store** : remplacer la description par celle ci-dessous (le résumé vient du manifeste). Remplacer les captures par celles listées plus bas, l’image de présentation en premier, et la grande vignette (le bouton et la mention AFK ont disparu).
3. **Confidentialité** : remplacer la justification de `alarms` et de `storage` par celles ci-dessous. Laisser « Code distant : Non ».
4. Vérifier que la page des règles de confidentialité est à jour en ligne (elle suit `store/privacy.md` une fois poussé sur GitHub).
5. **Envoyer pour examen**.

Ce qui a changé depuis la version examinée, si l’on veut le préciser :

- Les ouvertures AFK (ouverture automatique d’un paquet à 10/10) sont **supprimées** : plus aucun paquet n’est ouvert sans un clic de l’utilisateur. Une mise à jour efface leur alarme et leurs données locales.
- Deux nouveaux designs de paquet (vert, globe) et leurs dos de cartes ; le globe devient le design par défaut.
- L’ouverture fonctionne aussi sans accélération matérielle : le paquet y est dessiné à plat, en entier, et les effets les plus lourds pour le processeur sont retirés, pour qu’elle reste fluide.
- Anti-spoil garde l’ordre des cartes (la meilleure à la fin) et ne cache que les couleurs avant le retournement.
- Le dos des cartes est prêt dès qu’elles sortent du paquet (il pouvait apparaître en retard, en aplat de couleur).

## À téléverser

| Élément | Fichier |
|---|---|
| Paquet de l’extension | `dist/WikiRemastered-1.33.2-chrome-web-store.zip` (`manifest.json` à la racine, comme la boutique l’exige) |
| Icône de la boutique (128 × 128) | `store/images/icon-128.png` |
| Petite vignette promotionnelle (440 × 280, obligatoire) | `store/images/promo-small-440x280.png` |
| Grande vignette (1400 × 560, facultative) | `store/images/promo-marquee-1400x560.png` |
| Captures d’écran (1280 × 800, 5 au plus) | Dans cet ordre : `store/images/screenshot-0-presentation.png` (l’image de présentation : les fonctionnalités en mosaïque, sur les papiers des paquets), `screenshot-2-ouverture.png`, `screenshot-5-fiche.png`, `screenshot-7-marche.png`, `screenshot-8-collection.png`. En réserve : `-1-paquet`, `-3-revelation`, `-4-recapitulatif`, `-6-paquet-sombre`. |
| Visuels des designs (facultatif, pour une page ou un post) | `store/images/designs/` : faces des paquets et dos des cartes, en PNG transparent. |

Les images se refont avec `node scripts/brand.mjs`, `sh scripts/brand-png.sh`, `node scripts/store-shots.mjs` (captures 1 à 6, prises dans le labo avec des paquets simulés) et `sh store/presentation/render.sh` (l’image de présentation). Les captures 7 et 8 (Marché + et Collection +) viennent du vrai site, ramenées à 1280 × 800.

## Fiche

**Nom** (dans le manifeste) : WikiRemastered pour Wiki Masters

**Résumé** (132 caractères au plus, repris du manifeste) :
Thème graphite, ouvertures de paquets en 3D, collection enrichie, défausse et marché pour Wiki Masters. Extension non officielle.

**Catégorie** : Style de vie › Jeux

**Langue** : Français

**Description** :

> WikiRemastered donne une nouvelle peau et de nouveaux outils à Wiki Masters, le jeu de cartes Wikipédia (wiki-masters.com).
>
> Ouvrir un paquet devient un moment : le paquet arrive en 3D, se découpe d’un geste avec une petite paire de ciseaux, laisse filer une lumière et des pièces de puzzle aux couleurs des cartes qu’il contient, puis les cartes sortent et se révèlent une à une, la meilleure en dernier, avec sa mise en scène. Cinq designs de paquet au choix (globe, puzzle illustré, vert, foil sombre ou visuel d’origine), chacun avec son dos de cartes, un mode Anti-spoil qui ne trahit rien avant le retournement, et une fiche pour chaque carte, sans quitter l’ouverture.
>
> Et aussi :
> • un thème graphite soigné pour tout le site ;
> • Collection + : doublons regroupés, vues sur 30 jours et prix estimés sous chaque carte ;
> • défausse groupée des cartes que personne ne regarde, selon un seuil de vues et les raretés choisies ; favoris, cartes en échange et mots protégés sont toujours conservés ;
> • Marché + : vues et prix estimés sous les enchères, filtres, et des enchères en lot sur vos mots-clés, avec un plafond par carte et un budget total que vous fixez ;
> • succès débloqués réclamés automatiquement.
>
> Chaque ouverture de paquet se fait d’un clic de votre part. Tout fonctionne dans votre navigateur, sur wiki-masters.com uniquement, avec votre propre session. Aucune donnée n’est envoyée ailleurs.
>
> WikiRemastered est une extension non officielle, réalisée par un joueur. Elle n’est ni éditée ni approuvée par Wiki Masters. Code source public : https://github.com/Lypningeuh/WikiRemastered

## Confidentialité

**Objectif unique** :
Améliorer l’interface et l’expérience du jeu Wiki Masters sur wiki-masters.com : thème du site, ouverture des paquets, outils de collection et de marché.

**Justification des autorisations** :

| Autorisation | Justification |
|---|---|
| `storage` | Garder localement les préférences (son, vitesse, design du paquet, Anti-spoil, réglages de la collection et du marché), un cache de la collection et des prix pour éviter des requêtes répétées, et les réglages et le suivi des enchères que l’utilisateur a lancées. |
| `alarms` | Faire avancer Marché + quand l’onglet est en arrière-plan : la session d’enchères que l’utilisateur a activée (une vérification toutes les 30 secondes, dans le plafond et le budget qu’il a fixés) et les enchères qu’il a programmées lui-même. Tant que rien n’est activé, chaque réveil vérifie seulement qu’il n’y a rien à faire. |
| Accès à `https://www.wiki-masters.com/*` et `https://wiki-masters.com/*` | Le thème et les outils s’affichent sur ce site, et l’extension y lit la collection et le marché de l’utilisateur par les routes du site, avec sa session. Aucun autre site n’est concerné. |

**Code distant** : Non. Tout le code est dans le paquet.

**Utilisation des données** (cases à cocher) : l’extension manipule du « contenu de site web » (la collection, le marché et les paquets de l’utilisateur sur wiki-masters.com), uniquement dans le navigateur. Elle ne collecte, ne vend et ne transmet aucune donnée au développeur ni à un tiers. Cocher les trois certifications (pas de vente, pas d’usage sans rapport avec l’objectif, pas d’usage pour la solvabilité).

**Règles de confidentialité** : https://lypningeuh.github.io/WikiRemastered/store/privacy.html (publié par GitHub Pages depuis `store/privacy.md` ; si besoin, la version GitHub : https://github.com/Lypningeuh/WikiRemastered/blob/main/store/privacy.md).

## À vérifier avant de publier

- **Automatisations** : plus aucune ouverture de paquet automatique depuis 1.32.0. Marché + (enchères en lot par mots-clés, enchère programmée) et la réclamation des succès agissent sans clic au moment de l’action, seulement après activation par l’utilisateur et dans les limites qu’il fixe. Vérifier que le règlement de Wiki Masters le permet ; la boutique refuse les extensions qui aident à enfreindre les conditions d’un autre service.
- **Nom et marque** : « Wiki Masters » est le nom du jeu. La fiche le cite pour dire à quoi sert l’extension et précise qu’elle est non officielle ; ne pas utiliser le logo du jeu dans les visuels de la fiche.
- **Version** : chaque nouvel envoi doit avoir un numéro de version plus élevé dans `manifest.json`.
