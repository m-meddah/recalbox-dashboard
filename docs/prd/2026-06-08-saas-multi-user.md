# PRD — Recalbox Dashboard « famille en ligne » (multi-user)

- **Date** : 2026-06-08
- **Branche** : `feat/saas-multi-user` (basée sur `feat/recalbox-ui-refonte`)
- **Statut** : Draft — à valider avant plan d'implémentation
- **Auteur** : m-meddah

---

## 1. Contexte & problème

Le dashboard est aujourd'hui une application **auto-hébergée mono-utilisateur** :

- Aucune notion de compte — seul un cookie `setup_done` gate l'accès via le wizard de
  setup.
- Les **75 routes `/api/*` sont servies sans aucune authentification**
  ([proxy.ts](../../apps/dashboard/proxy.ts) laisse passer tout `/api/`).
- L'accès aux machines se fait **en direct sur le LAN** : SSH
  ([ssh-client.ts:39](../../apps/dashboard/lib/recalbox/ssh-client.ts#L39)) et MQTT
  ([mqtt-client.ts:168](../../apps/dashboard/lib/recalbox/mqtt-client.ts#L168)) ciblent
  l'hôte stocké dans la table `recalboxes`.

On souhaite une version **en ligne**, partagée par un **petit cercle de confiance
(famille)**, où chacun gère ses propres Recalbox situées dans des **foyers différents**
(donc derrière des box/NAT distincts), avec **contrôle complet à distance** (lancer un
jeu, éteindre/redémarrer, now-playing temps réel, proxy des jaquettes).

Le défi central n'est ni le multi-user ni la base de données — c'est la **topologie
réseau** : un serveur en ligne ne peut pas joindre directement des Recalbox situées
derrière des NAT domestiques.

## 2. Objectifs

- Comptes multiples, accès en ligne sécurisé, pour un cercle fermé.
- Un utilisateur possède **plusieurs** Recalbox (ex. Pi3 + Pi4 + 2× Pi5).
- Contrôle complet à distance de **ses** machines.
- Un rôle **admin** capable de **consulter en lecture seule** les Recalbox et stats de
  tous les utilisateurs.
- Réutiliser au maximum le pipeline Recalbox existant (SSH/MQTT/scrobbler).

## 3. Hors périmètre (YAGNI)

- Facturation / abonnements.
- Inscription publique ouverte.
- Partage **N-à-N** d'une même machine entre plusieurs comptes en écriture.
- Migration vers Postgres / base par utilisateur.
- Agent de connectivité sur-mesure (un protocole agent↔cloud propriétaire).

> Tous ces points restent ajoutables ultérieurement sans casser le socle décrit ici.

## 4. Décisions d'architecture

| Sujet | Décision |
|---|---|
| Connectivité | Mesh VPN (Tailscale, ou Headscale auto-hébergé) |
| Authentification | Better Auth, **invitation-only** |
| Stockage | **SQLite unique** existant, scoping par utilisateur |
| Modèle de propriété | **1-à-N** : `users (1) → (N) recalboxes` |
| Rôles | `admin` (lecture seule globale) / `member` |
| Déploiement | Conteneur Docker existant sur hôte always-on, sur le tailnet |

## 5. Connectivité — mesh VPN (≈ 0 code)

- Chaque foyer héberge un nœud Tailscale **subnet router** (l'appareil always-on déjà
  présent, ou un Raspberry Pi) qui annonce le LAN local. **Le Recalbox n'est pas
  modifié** : il reste joignable via son IP LAN, routée à travers le subnet router.
- Le serveur central est sur le même tailnet et joint chaque Recalbox de façon
  transparente.
- Conséquence : le pipeline SSH/MQTT/scrobbler **ne change pas**. Seules les IP cibles
  (données de la table `recalboxes`) deviennent des IP tailnet.

## 6. Authentification & multi-user

- Tables `users` + sessions gérées par **Better Auth**.
- Création de comptes **par invitation** (lien magique / compte pré-créé) — pas
  d'inscription libre.
- Colonne `role: 'admin' | 'member'` sur `users`.
- Le flux `setup_done` actuel est remplacé/complété par un vrai login ;
  [proxy.ts](../../apps/dashboard/proxy.ts) redirige les non-authentifiés vers `/login`.

## 7. Propriété & scoping des données (SQLite unique)

- Nouvelle colonne `owner_user_id` (FK `users`) sur `recalboxes`
  ([schema.ts:4](../../apps/dashboard/lib/db/schema.ts#L4)).
- **Scoping transitif** : les tables de données (`sessions`, `games`,
  `system_snapshots`, `notifications`, `ra_*`…) portent déjà `recalbox_id`. Filtrer par
  les recalbox de l'utilisateur suffit — inutile d'ajouter `user_id` partout.
- Deux portées distinctes :
  - **Lecture** — `getViewableRecalboxIds(user)` : un *member* voit ses recalbox ; un
    *admin* voit **toutes** les recalbox.
  - **Contrôle / écriture** — `assertOwnsRecalbox(userId, recalboxId)` : **propriétaire
    uniquement**, admin inclus (l'admin ne contrôle pas les machines des autres).
- [getActiveRecalboxId](../../apps/dashboard/lib/recalbox/active.ts) devient
  *user-aware* : le cookie `active_recalbox_id` n'est accepté que s'il fait partie des
  recalbox visibles par l'utilisateur ; fallback sur la première visible sinon.
- Le sélecteur multi-Recalbox existant est conservé — il n'affiche que les machines
  visibles par l'utilisateur courant.

## 8. Protection des routes (cœur du travail sécurité)

- Garde d'authentification partagé `requireUser()` appliqué à toutes les routes
  `/api/*`.
- **Routes lecture** (stats, sessions, collection, achievements, wrapped…) → filtre via
  `getViewableRecalboxIds`.
- **Routes action** (`system/power`, `collection/launch`, `play-tonight/launch`,
  `collection/sync`, `media`, `game-media`, `recalboxes/[id]` en édition…) → garde
  `assertOwnsRecalbox`.
- Front : un drapeau `canControl` est transmis aux écrans pour masquer/désactiver les
  boutons d'action quand l'utilisateur n'est pas propriétaire (évite les 403 visibles).

## 9. Vue admin (lecture seule)

- Section read-only listant les utilisateurs et leurs stats agrégées (temps de jeu, top
  jeux, dernières sessions, état des machines), réutilisant les calculateurs de
  [lib/stats/](../../apps/dashboard/lib/stats/) sans le filtre de propriété.
- Minimale au départ ; enrichissable ensuite.

## 10. Déploiement

- **Conteneur Docker existant** (Next.js + scrobbler via s6-overlay) déployé sur un hôte
  **always-on** (petit VPS ou serveur perso), lui-même membre du tailnet.
- **Pas de serverless** (Vercel inadapté : MQTT/SSE/SSH sont des connexions longues).
- HTTPS via reverse proxy (Caddy/Traefik) ou Tailscale Funnel.

## 11. Sécurité

- **Chiffrer les credentials SSH** stockés en base : le serveur est désormais exposé en
  ligne.
- Tout `/api/*` derrière authentification + vérification de propriété sur les actions
  ciblant une machine.
- Le tailnet limite fortement la surface : les Recalbox ne sont jamais exposés
  directement à Internet.

## 12. Phasage indicatif de l'implémentation

1. **Auth + garde de routes** (Better Auth, `requireUser`, middleware) — socle bloquant.
2. **Propriété** (`owner_user_id`, scoping des requêtes, `getActiveRecalboxId`
   user-aware, `assertOwnsRecalbox`, `getViewableRecalboxIds`).
3. **Rôles + vue admin** lecture seule.
4. **Chiffrement des credentials SSH**.
5. **Connectivité tailnet** (ops + documentation d'installation par foyer).
6. **Déploiement** (Docker sur hôte always-on + HTTPS).

## 13. Risques & points ouverts

- **Connectivité intermittente** : si le subnet router d'un foyer tombe, ses Recalbox
  deviennent injoignables (now-playing/contrôle KO). Le scrobbler doit rester tolérant
  aux déconnexions (déjà conçu pour l'auto-reconnexion).
- **Migration des données existantes** : assigner les recalbox déjà présentes à un
  `owner_user_id` lors de la première migration (probablement l'admin).
- **Choix Tailscale vs Headscale** : à trancher (SaaS clé en main vs auto-hébergé) —
  n'impacte pas le code applicatif.
