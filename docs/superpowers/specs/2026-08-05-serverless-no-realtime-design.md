# Abandon du temps réel en mode serverless

**Date** : 2026-08-05
**Statut** : conception validée, prête pour le plan d'implémentation

## Problème

En mode serverless (Vercel + Turso), le dashboard maintient un flux SSE par onglet
ouvert. Faute de lien MQTT du cloud vers la box (NAT), ce flux n'est pas alimenté
par des événements : il **interroge la base en boucle**.

Cadences actuelles dans `app/api/events/route.ts` :

| Signal | Actif | Idle (serverless) |
| --- | --- | --- |
| now-playing | 10 s | 30 s |
| notifications | 20 s | 20 s |
| connexion + system-info + feedback | 30 s | 60 s |
| heartbeat | 15 s | 15 s |

Chaque stream vit 290 s puis le client se reconnecte, ce qui relance une fonction
Vercel. S'y ajoute un poll indépendant du SSE : `notification-bell.tsx` déclenche
`setInterval(fetchNotifications, 30000)`.

Le coût est double, et c'est le mécanisme à l'origine de l'incident du 2026-07-02 :

- **lectures Turso** — un onglet oublié consomme des dizaines de milliers de lectures par jour ;
- **Fluid Active CPU** — une fonction maintenue chaude en permanence, facturée sur un
  plafond partagé par tout le compte.

Par ailleurs, le panneau système (CPU / RAM / température / stockage) **duplique la page
monitoring du Web Manager Recalbox**. Il ne justifie pas son coût.

## Décisions

1. **Le SSE est entièrement supprimé en mode serverless.** Pas de stream, quelle que soit
   la page.
2. **L'agent cesse de pousser les snapshots système**, et le serveur cesse de les écrire.
   La table `system_snapshots` reste en place : le chemin self-hosted (SSH →
   `insertSystemSnapshot`) continue de l'alimenter.
3. **Le now-playing et l'état en ligne sont rendus côté serveur au chargement**, avec un
   bouton Rafraîchir explicite et l'horodatage du dernier signal.
4. **La cloche de notifications perd son intervalle** en serverless : fetch au montage et
   à l'ouverture du popover. Le temps réel passe par le Web Push déjà en place.

Le mode self-hosted n'est pas modifié : MQTT et le flux SSE restent inchangés.

## Approche retenue : amorcer le provider

`RecalboxEventsProvider` reçoit deux nouvelles props : `live` et `initialState`. En
serverless il n'ouvre jamais d'`EventSource` et son état initial est calculé côté serveur.

```text
AVANT (serverless)                    APRÈS (serverless)
─────────────────                     ──────────────────
layout ─┐                             layout (RSC)
        └─ Provider                     ├─ getNowPlaying(box)
             └─ EventSource ──┐         ├─ getAgentLastSeen()
                              │         └─ Provider live={false} initialState={…}
                        /api/events          └─ (aucun EventSource)
                         ├ 10s now-playing
                         ├ 20s notifs        router.refresh() ──► re-rend le RSC
                         ├ 30s conn+sys           └─ ré-amorce le contexte
                         └ 15s heartbeat
                        × 290s × onglet
```

`nowPlayingToEvent()` (`lib/db/now-playing.ts`) reconstruit déjà exactement la forme
d'événement que l'UI consomme. Le contexte peut donc être amorcé sans toucher au rendu.

### Pourquoi pas des composants serveur dédiés

`mqttOnline` n'est pas lu que par le panneau système. `launch-game-button.tsx`,
`collection/emulator-override-button.tsx` et `play-tonight/play-tonight-results.tsx`
s'en servent pour griser leurs actions. Amorcer le contexte les garde corrects sans
effort ; des composants statiques dédiés les auraient tous fait basculer en « hors ligne »,
et auraient dupliqué les ~400 lignes de rendu de cartes de `now-playing.tsx`.

### Pourquoi pas un SSE « one-shot »

Émettre l'état puis fermer donnerait le plus petit diff, mais conserverait une invocation
de fonction *streaming* par chargement de page, et la logique de reconnexion du client
entrerait en conflit avec la fermeture immédiate.

## Composants touchés

| Fichier | Changement |
| --- | --- |
| `app/recalbox-events-provider.tsx` | props `live` + `initialState` ; sortie anticipée de l'effet `EventSource` **et** du fallback 10 s quand `live` est faux |
| `app/[locale]/layout.tsx` | calcule `initialState` en RSC quand `serverless`, le passe au provider |
| `app/api/events/route.ts` | `204 No Content` immédiat si `isServerlessMode()` |
| `app/[locale]/page.tsx` | en serverless : suppression de `SystemStatsChart` et `ServerlessSystemPanel`, ajout du bloc Rafraîchir |
| `components/notification-bell.tsx` | `useServerless()` → pas d'intervalle ; fetch au montage et à l'ouverture du popover |
| `agent/agent.py` | `snapshot_interval_sec: 0` par défaut ; garde `<= 0` avant de démarrer le thread `snapshot_loop` |
| `agent/config.example.json` | `snapshot_interval_sec` passe de `300` à `0` |
| `app/api/agent/snapshots/route.ts` | accepte et ignore la charge utile (`204`), sans écriture |
| `components/refresh-live-state.tsx` *(nouveau)* | bouton `router.refresh()` et libellé « dernier signal il y a X » |

### Explicitement inchangés

- `components/feedback/feedback-prompt-provider.tsx` — fetch déjà au montage ; son
  `subscribe` devient un no-op silencieux.
- `components/notification-listener.tsx` — perd ses toasts intra-page en serverless, le
  Web Push prend le relais ; `registerServiceWorker()` continue de s'exécuter.
- `components/system-stats-chart.tsx`, `components/serverless-system-panel.tsx` — plus
  montés en serverless, mais conservés tels quels pour le self-hosted.
- Table `system_snapshots` et `insertSystemSnapshot` — alimentés par le collecteur SSH du
  self-hosted, inchangés.
- Tout le chemin self-hosted : `mqttPool`, les abonnements MQTT de la route SSE, le
  scrobbler.

### Bug préexistant corrigé au passage

`agent/README.md` documente déjà « `snapshot_interval_sec` … `0` disables », mais
`snapshot_loop` n'a aucune garde `<= 0` et son thread démarre inconditionnellement, à la
différence de `collection_loop` et `artwork_loop` qui sont tous deux gardés. Le
comportement documenté n'a jamais existé ; ce travail l'implémente.

### Note opérationnelle

`load_config()` fusionne `config.json` par-dessus les défauts. Les box déjà enrôlées
portent une valeur explicite (`300` dans `config.example.json`), qui écrase donc le
nouveau défaut : elles continueraient de pousser jusqu'à mise à jour de leur fichier.

C'est la raison d'être du no-op côté serveur : les écritures Turso tombent à zéro
immédiatement, sans intervention sur aucune box. Le changement côté agent élimine ensuite
l'appel HTTP lui-même, au fil des mises à jour. Aucune coordination de déploiement n'est
nécessaire, dans un sens comme dans l'autre.

## Flux de données

`initialState` est calculé une fois par rendu de layout :

```ts
type SeedState = {
  box: string | null
  game: GameStartEvent | null // via nowPlayingToEvent(row)
  online: boolean // now - lastUsedAt < AGENT_LIVENESS_MS
  lastSeenAt: Date | null // pour l'affichage « il y a X »
}
```

Sources : `getNowPlaying(db, activeRecalboxId)` et `getAgentLastSeen(db)`.

**Garde d'autorisation** : l'amorçage n'a lieu que si `viewable.has(activeRecalboxId)`.
Le layout calcule déjà `viewable` via `getViewableRecalboxIds`. Sans ce test, le seed
rejouerait la fuite inter-utilisateurs que la route SSE corrige avec ce même appel.

`lastSystemInfo` reste `null` en serverless, puisque le panneau système disparaît et que
l'agent n'envoie plus de snapshots.

Le bouton Rafraîchir appelle `router.refresh()`, ce qui ré-exécute le layout RSC et
produit un `initialState` à jour.

## Erreurs et cas limites

- **Lecture DB en échec au layout** → `initialState` nul, provider en `online: false`.
  La page se rend normalement.
- **Aucune box active** → `box: null`, ce qui correspond au cas non filtré déjà géré.
- **Bundle client périmé** qui appelle `/api/events` → `204`, `readyState` passe à
  `CLOSED`, le chemin `refused` de `lib/sse/reconnect-delay.ts` applique son backoff long.
  Pas de martèlement.
- **Agent d'une version antérieure** qui pousse encore des snapshots → la route continue
  de les accepter, ils sont simplement ignorés à l'affichage. Pas de rupture de
  compatibilité, aucune coordination de déploiement nécessaire.

## Tests

- Provider avec `live={false}` : aucun `EventSource` n'est construit, l'état amorcé est
  lisible dès le premier rendu.
- Provider avec `live={true}` : comportement actuel intact (non-régression self-hosted).
- Route `/api/events` : `204` en serverless, stream en self-hosted.
- Amorçage : une box absente de `viewable` ne produit pas d'`initialState`.
- Cloche : aucun intervalle en serverless, fetch déclenché à l'ouverture du popover.
- Agent : `snapshot_interval_sec = 0` ne démarre pas de thread `snapshot_loop`.
- Route `/api/agent/snapshots` : en serverless, un push authentifié répond `204` et
  n'insère aucune ligne dans `system_snapshots`.

## Gain attendu

Par onglet laissé ouvert 24 h en serverless :

| | Avant | Après |
| --- | --- | --- |
| Lectures DB (stream) | ~17 000 | 0 |
| Invocations Vercel (stream) | ~300 | 0 |
| Invocations Vercel (cloche) | ~2 880 | ~1 + ouvertures |
| Écritures Turso (snapshots, par box) | 1 440 | 0 |

Le point décisif n'est pas le volume brut mais la disparition de toute fonction maintenue
chaude en continu — le poste **Fluid Active CPU** à l'origine de l'incident.

## Hors périmètre

- Le comportement self-hosted, inchangé.
- Le Web Push et le service worker, inchangés.
- La suppression de la table `system_snapshots` ou de `/api/system-stats` (cette route n'a
  déjà plus de consommateur client, mais son sort relève d'un nettoyage distinct).
