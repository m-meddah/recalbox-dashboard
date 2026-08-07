# Exploiter le Web Manager et les événements ES non consommés

**Date** : 2026-08-07
**Statut** : conception validée, prête pour le plan d'implémentation

## Problème

Une revue du [wiki Recalbox](https://wiki.recalbox.com/fr/home) croisée avec le code a
mis en évidence cinq gisements de données déjà présents sur la box mais que le
dashboard n'exploite pas :

1. Le catalogue `/api/systems` du Web Manager est consommé partiellement — la moitié
   de ses champs est ignorée.
2. Les captures d'écran de la box (`/recalbox/share/screenshots`) n'ont aucune
   surface dans le dashboard, alors que le Web Manager sait les lister, en produire
   et les supprimer.
3. Sur les 18 événements EmulationStation documentés, `events.ts` n'en traite que 7.
   Les événements de scrape, de changement de configuration et d'arrêt système sont
   perdus.
4. L'émulateur et le core effectivement utilisés pour une partie ne sont jamais
   enregistrés, alors que l'information transite à chaque lancement.
5. La version de Recalbox, du kernel, de RetroArch et de chaque core est exposée par
   `/api/versions` et n'est affichée nulle part — y compris sur la page multi-box où
   comparer les versions aurait le plus de valeur.

## Périmètre

**Mode self-hosted uniquement.** Le Web Manager écoute sur le port 81 de la box et
n'est joignable que depuis le LAN (ou le tailnet). Vercel ne peut pas l'appeler. Tout
ce qui en dépend est donc masqué en mode serverless via `isServerlessMode()`, comme
le sont déjà `/configuration` et `PowerControls`. L'extension de l'agent Python pour
relayer ces données est un chantier ultérieur, à cadrer séparément.

**Exception assumée** : la clôture de session sur arrêt de la box (piste 3) est
implémentée côté agent Python *aussi*. C'est du MQTT, pas du port 81, et ne pas le
faire ferait diverger les deux scrobblers sur un comportement observable.

## Sources vérifiées

Les formes de données ci-dessous ont été relevées en direct sur une Recalbox 10.1
(`recalbox.local`), pas déduites de la documentation.

`GET /api/systems` — un système :

```json
{ "name": "2048", "fullName": "2048", "uuid": "...", "themeFolder": "2048",
  "manufacturer": "port", "releaseDate": "2014-03", "type": 7,
  "extensions": ".game", "romPath": ["/recalbox/share_init/roms/ports/2048"],
  "inputs": { "pads": 1, "keyboard": 4, "mouse": 4 },
  "properties": { "hasLightgunSupport": false, "isReadOnly": true,
                  "isPort": true, "hasNetplay": false },
  "emulators": [ { "emulator": "libretro", "core": "2048", "availableOnCRT": true,
                   "hasNetplay": false, "priority": 1, "speed": 1,
                   "compatibility": 1 } ] }
```

La réponse porte aussi un bloc `enumerations` (`systemTypes`, `deviceRequirement`,
`emulatorSpeed`, …) qui donne le libellé de chaque code entier. `deviceRequirement` :
`0 Unknown, 1 Mandatory, 2 Recommended, 3 Optional, 4 No need`.

`GET /api/media` :

```json
{ "mediaPath": "/recalbox/share/screenshots",
  "mediaList": { ".keep": {"type":"image"}, "readme.txt": {"type":"unknown"} } }
```

`GET /api/status` — état ES en HTTP, avec le core **réellement sélectionné** :

```json
{ "Action": "startgameclip", "Version": "2.0",
  "System": { "SystemId": "neogeo", "DefaultEmulator": {"Emulator":"libretro","Core":"fbneo"} },
  "Game": { "Game": "Fatal Fury", "GamePath": "...", "Favorite": true,
            "SelectedEmulator": { "Emulator": "libretro", "Core": "fbneo" } } }
```

`GET /api/versions` : `{ webapi, recalbox, linux, libretro: { retroarch, cores: {…} } }`.
Le champ `recalbox` est renvoyé avec un `\n` final (`"10.1-patron-1\n"`) — à trimmer.

Payload MQTT réel sur `Recalbox/WebAPI/EmulationStation/Event` (capturé au
`mosquitto_sub`) : les clés sont en camelCase et **diffèrent de celles de
`/api/status`**. `system` porte `defaultEmulator` et `defaultCore` (des chaînes, pas
un objet), `game` porte `metadata`, `genreName`, `players`, `region`, `Favorite`.

Surface complète de l'API Manager, extraite du bundle JS du Web Manager :
`/architecture`, `/status`, `/versions`, `/bios`, `/media`, `/media/screenshot/{n}`,
`/media/takescreenshot`, `/monitoring/storageinfo`, `/roms`, `/roms/total`,
`/systems`, `/systems/{s}/roms`, `/systems/{s}/roms/metadata/info/{r}`,
`/configuration/{20 sections}`, `/system/frontend/{start,stop,restart}`,
`/system/{reboot,shutdown,resetfactory}`, `/system/supportarchive/generate`.

**Il n'existe aucun endpoint de déclenchement de mise à jour.** Le point 5 se limite
donc à l'affichage.

## Architecture

### Module `lib/recalbox/manager/`

Les appels au Web Manager sont aujourd'hui éparpillés dans trois fichiers plats qui
recopient chacun leur base URL, leur timeout et leur `try/catch`. Les cinq pistes
ajoutent trois appelants de plus. On regroupe :

```text
lib/recalbox/manager/
  client.ts     managerFetch(host, path, { method, body, timeoutMs })
                base http://{host}:81/api, AbortSignal.timeout, log unique
  config.ts     ← lib/recalbox/web-config.ts
  catalog.ts    ← fetchSystemsCatalog, étendu
  bios.ts       ← lib/recalbox/bios.ts
  media.ts      nouveau
  versions.ts   nouveau
  status.ts     nouveau
```

`client.ts` porte la seule règle de transport : **lecture best-effort** (renvoie
`null`, log en `warn`, jamais d'exception) contre **écriture stricte** (throw, pour
que les routes puissent répondre 503). C'est le contrat déjà appliqué de fait dans
`web-config.ts` ; il devient explicite et unique.

**`lib/recalbox/storage.ts` ne bouge pas.** Son type `StorageMount` est importé par
`lib/db/schema.ts`, `lib/recalbox/events.ts` et `lib/agent/ingest-snapshot.ts` — du
code qui décrit du stockage poussé par l'agent, sans aucun rapport avec le port 81.
Le déplacer ferait dépendre le schéma de base d'un client HTTP. Le fichier reste en
place et bascule simplement sur `managerFetch` pour son transport.

Pas de fichier `index.ts` de compatibilité : les sites d'import de `bios.ts` et
`web-config.ts` sont mis à jour directement. Une couche d'indirection masquerait le
déplacement sans rien simplifier.

Pas de cache. Les pages concernées sont toutes `force-dynamic` et lisent la box à
chaque rendu ; un cache introduirait une invalidation à raisonner pour un gain non
mesuré.

### Modèle de données

Une seule migration Drizzle : `sessions` gagne deux colonnes nullables.

| Colonne    | Type   | Source                                        |
| ---------- | ------ | --------------------------------------------- |
| `emulator` | `text` | `/api/status` → repli sur MQTT `defaultEmulator` |
| `core`     | `text` | `/api/status` → repli sur MQTT `defaultCore`     |

Pas de backfill : l'information n'existe pas rétroactivement. Les sessions
antérieures resteront à `null` et toute agrégation doit traiter ce cas comme une
catégorie « inconnu », pas comme zéro.

Aucune autre table. Les captures ne sont pas persistées — la box reste la source de
vérité, le dashboard n'est qu'une vue. Les versions sont lues en direct.

## Les cinq pistes

### 1. Catalogue systèmes étendu

`fetchSystemsCatalog` existe déjà et alimente `/configuration/systems` ainsi que
`components/collection/emulator-override-button.tsx`. Le sélecteur de core, avec
`priority` / `speed` / `compatibility`, **est déjà construit** — cette piste ne le
refait pas.

`SystemCatalogEntry` gagne les champs aujourd'hui jetés au parsing :

- `type` — code entier résolu via `enumerations.systemTypes`
- `releaseDate`, `extensions`
- `properties.{ hasLightgunSupport, hasNetplay, isPort, isReadOnly }`
- `inputs.{ pads, keyboard, mouse }` — résolus via `enumerations.deviceRequirement`
- `emulators[].availableOnCRT`

Surface :

- Liste des systèmes : badges Lightgun, Netplay, Port, CRT. Le badge Netplay lit
  `properties.hasNetplay` (niveau système) ; `emulators[].hasNetplay`, déjà parsé,
  reste l'information par core.
- Fiche d'un système : constructeur, année de sortie, type, extensions acceptées,
  périphériques requis ou recommandés.
- `/configuration/systems` : badge CRT par core.

Ces propriétés sont **par système, pas par jeu**. Un filtre « jeux compatibles
lightgun » dans la table par jeu n'est pas alimentable par cette source ; la liste
par jeu du wiki est de la documentation, pas une API.

Box injoignable → `[]`, les badges disparaissent, la page reste fonctionnelle.

### 2. Galerie de captures

`media.ts` :

| Fonction              | Appel Manager                  |
| --------------------- | ------------------------------ |
| `listMedia(host)`     | `GET /api/media`               |
| `takeScreenshot(host)`| `POST /api/media/takescreenshot` |
| `deleteMedia(host,n)` | `DELETE /api/media/{n}`        |
| `fetchMedia(host,n)`  | `GET /api/media/screenshot/{n}`|

`listMedia` filtre les entrées `type: "unknown"` : le dossier contient des
`readme.txt` et un `.keep` livrés par Recalbox.

Routes sous `app/api/screenshots/` — **pas** `/api/media`, déjà occupé par le proxy
de jaquettes, et la collision de nom serait un piège durable :

- `GET /api/screenshots` — liste
- `POST /api/screenshots` — déclenche une capture
- `GET /api/screenshots/[name]` — binaire proxifié
- `DELETE /api/screenshots/[name]`

Page `app/[locale]/screenshots/`, grille de vignettes, suppression avec
confirmation. Le bouton « prendre une capture » n'est actif que si un jeu tourne,
état lu via `status.ts`.

**Sécurité** : `name` vient du client et finit dans une URL vers la box. Il est
validé contre une liste blanche stricte (pas de `/`, pas de `..`, pas de séquence
d'échappement) avant tout appel, et les routes appliquent les mêmes gardes d'auth et
d'appartenance que les autres routes de contrôle de box (`canControlRecalbox`).

### 3. Événements EmulationStation manquants

Nouveaux types dans `events.ts` :

- `scrap:start`, `scrap:game { romPath }`, `scrap:stop { count }`
- `frontend:state { state: 'start'|'stop'|'shutdown'|'reboot'|'quit'|'relaunch' }`
- `config:changed`

**Incertitude assumée** : la forme exacte du payload MQTT de ces événements n'a pas
pu être observée — les déclencher supposait de perturber la box de l'utilisateur.
Seul `startgameclip` a été capturé en direct. Le parseur est donc défensif : `param`
est lu de façon tolérante (absent, chaîne, ou nombre), et l'absence des sous-objets
`system` / `game` / `media` est traitée comme normale pour ces événements. Les tests
couvrent explicitement les formes dégradées. Ces parseurs seront à revalider contre
un payload réel lors de l'implémentation.

Consommateurs :

**`scrapstop` → resynchronisation de la collection.** La logique d'import vit
aujourd'hui dans le handler `POST /api/collection/sync`, entrelacée avec son
streaming NDJSON. On l'extrait dans `lib/collection/sync.ts` :

```text
syncCollection(recalboxId, { system?, onProgress? }) → { totalGames, durationMs }
```

La route l'appelle en branchant `onProgress` sur son flux NDJSON ; le scrobbler
l'appelle sans progression. Sans cette extraction, la resync ne pourrait être
déclenchée que par un onglet ouvert — or on scrape depuis la télé, pas depuis le
navigateur, et la fonctionnalité serait vide de sens.

**`configurationchanged`.** Il n'y a **pas** de cache serveur à invalider : toutes
les pages `/configuration/*` sont `force-dynamic`. Le gain est côté client —
l'événement est relayé en SSE et l'onglet ouvert déclenche `router.refresh()`. Côté
serveur, seul `invalidateSystemsCache` (`lib/recalbox/systems.ts`) est appelé.

**`shutdown` / `reboot` / `stop` / `quit`.** Clôture de la session ouverte avec
`autoClosed: true` et `closedReason: 'box_shutdown'`. Implémenté dans le
`SessionManager` TS **et** dans le `SessionTracker` Python de l'agent, pour que les
deux scrobblers produisent la même donnée.

**`start` / `relaunch`.** Relayés dans l'état du contexte SSE, sans persistance.

### 4. Émulateur et core par session

`system.defaultCore` est présent dans le payload MQTT et simplement ignoré
aujourd'hui — le parser le lit désormais.

Mais MQTT ne porte que le **défaut système**. Si un override par jeu existe — ce que
le dashboard sait précisément écrire via `emulator-override-button` — la valeur MQTT
est fausse. Au `game:start`, le scrobbler lit donc `/api/status` une fois pour
récupérer `Game.SelectedEmulator`, en best-effort (6 s, un seul appel par session),
et retombe sur les valeurs MQTT en cas d'échec ou de mode serverless.

Côté agent Python, la même donnée est disponible localement dans
`/recalbox/share/system/.emulationstation/es_state.inf` (clés `Emulator` et `Core`,
format v2.0) — pas d'appel HTTP nécessaire.

Exploitation : un découpage « temps de jeu par core » sur `/stats`, tolérant aux
sessions historiques sans core.

**Reporté explicitement** : le conseil de core (« ce jeu tourne sur un core noté Low
alors qu'un core High est disponible »), qui croiserait cette donnée avec le
`compatibility` du catalogue. Il ne peut rien dire tant que la donnée n'a pas été
accumulée.

### 5. Versions et mises à jour

`versions.ts` → `fetchVersions(host)`, en trimmant `recalbox`.

- Carte « Système » sur la page d'une box : version Recalbox, kernel, RetroArch,
  nombre de cores, liste complète repliée.
- `/all-recalboxes` : colonne version, avec mise en évidence des divergences entre
  boxes. Fetch parallèle, best-effort — une box hors ligne affiche un tiret, pas une
  erreur.
Pas de déclenchement de mise à jour : l'API ne l'expose pas.

Rien à faire côté configuration : la section `updates` est déjà déclarée dans
`CONFIG_SECTIONS` et le rendu générique expose donc déjà `updates.enabled` et
`updates.type`.

## Gestion d'erreur

Le contrat est uniforme et déjà celui du code existant : **une box injoignable ne
casse jamais une page**. Les lectures renvoient une valeur vide, l'UI affiche un état
« indisponible », et le log passe en `warn`. Seules les actions explicites de
l'utilisateur — prendre une capture, supprimer, écrire une clé de configuration —
remontent une erreur visible et un 503.

## Tests

- `lib/recalbox/manager/__tests__/` — parseurs `catalog`, `media`, `versions`,
  `status`, avec `fetch` mocké. Le pattern de `web-config.test.ts` est repris tel
  quel, y compris les cas « box injoignable » et « réponse malformée ».
- `events.test.ts` — les six nouveaux événements, plus leurs formes dégradées
  (payload sans `param`, sans `system`, double-JSON).
- `session-manager` — clôture sur `frontend:state: shutdown`, et non-clôture sur
  `start`.
- `lib/collection/__tests__/sync.test.ts` — l'extraction doit préserver le
  comportement existant de la route.
- `agent/__tests__/` — parsing des nouveaux événements et clôture de session Python.
- Routes `screenshots` — validation du nom de fichier (traversée de chemin refusée)
  et gardes d'auth.

## Décisions écartées

| Option                                        | Raison                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| Archiver les captures en base / stockage objet | Nouvelle table, sweep, quota blob — pour un historique non demandé.     |
| Cache TTL sur `/api/systems` et `/api/versions`| Invalidation à raisonner pour un gain non mesuré sur des pages dynamiques. |
| API REST Recalbox (`system.api.enabled`, :1337)| Dépôt `recalbox-api` abandonné, cassé de longue date. Le Manager v2 est la bonne porte. |
| Déclencher une mise à jour depuis le dashboard | Aucun endpoint côté box.                                                |
| Filtre « jeux lightgun » par jeu               | `hasLightgunSupport` est une propriété système ; la liste par jeu n'est que documentaire. |
| Relais agent pour les données du port 81       | Reporté à un chantier serverless dédié.                                 |
