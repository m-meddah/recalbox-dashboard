# Installation plug & play de l'agent — design

**Date** : 2026-08-18
**Statut** : conception validée, prête pour le plan d'implémentation

## Problème

Enrôler une Recalbox en mode serverless demande aujourd'hui à l'utilisateur de se
connecter en SSH à sa propre machine, d'y copier `agent.py` et `scan_roms.py` à la
main, d'écrire un `config.json` et de bricoler un `custom.sh`. La procédure vit dans
[`docs/serverless-deploy.md`](../../serverless-deploy.md) — rien dans l'application ne
la guide.

C'est inutilisable pour le public visé. Recalbox se revendique plug & play ; un
utilisateur qui n'a jamais ouvert un terminal doit pouvoir connecter sa box.

Trois obstacles supplémentaires, corrigés hors de cette spec mais qui la motivent :
le formulaire d'ajout refusait un mot de passe SSH vide alors que le cloud n'ouvre
jamais de connexion SSH, il proposait un test de connexion qui échoue toujours en
serverless, et l'enregistrement d'une box échouait pour tout le monde dès qu'on ne
retapait pas le mot de passe.

## Objectif

Depuis le dashboard, connecter une Recalbox neuve sans terminal, sans mot de passe à
saisir, sans notion technique — et sans jamais avoir à recommencer quand l'agent
évolue.

## Contrainte structurante

Le cloud ne peut pas joindre la box : c'est le principe même du mode serverless
(l'agent pousse vers l'extérieur, ce qui traverse le NAT domestique). L'installation
doit donc **partir du poste de l'utilisateur**.

Et le navigateur ne peut pas écrire sur la box. Ce n'est pas un manque d'effort, c'est
structurel — vérifié sur une box réelle le 2026-08-18 :

| Chemin | Verdict |
| --- | --- |
| Page HTTPS → API locale en HTTP | bloqué par le navigateur (contenu mixte) |
| Navigateur → SMB | le navigateur ne parle pas SMB |
| Navigateur → SSH | le navigateur ne parle pas SSH |
| API du Web Manager (port 81) | **aucune primitive d'écriture** |

Le dernier point est le plus important, car c'était la piste la plus séduisante. Le
Web Manager expose pourtant un CORS grand ouvert (`Access-Control-Allow-Origin: *`)
et aucune authentification, mais toutes ses routes de fichiers sont en lecture seule :

```
POST /api/bios                 → 405  Allow: GET
POST /api/media                → 405  Allow: GET
POST /api/systems/ports/roms   → 405  Allow: DELETE, GET
```

Il ne reste donc que deux chemins d'écriture sur une Recalbox : **le partage réseau**
et **SSH**. Cette spec retient le partage réseau ; SSH reste en réserve (voir « Hors
périmètre »).

## Ce qui a été vérifié sur une box réelle

Toutes les affirmations ci-dessous sont mesurées, pas supposées (Recalbox sur
Raspberry Pi, 2026-08-18) :

- **Samba est actif et ouvert.** Le partage `[share]` expose `/recalbox/share` avec
  `writeable = yes`, `guest ok = yes` et `map to guest = bad user` : **aucun mot de
  passe**. `force user = root` règle les permissions. Sous Windows, `\\RECALBOX`
  suffit.
- **`/recalbox/share/userscripts/` existe**, et la convention y est **un fichier par
  script**, nommé `nom[évènement].sh`. Recalbox s'en sert lui-même
  (`allinone[systembrowsing].sh`, écrit par `/etc/init.d/S13allinone`). Un nom unique
  ne peut donc entrer en collision avec aucun fichier existant.
- **L'évènement `start` n'existe pas** (le `START` trouvé dans le binaire ES est le
  bouton de manette). `systembrowsing` existe et se déclenche quand ES affiche la
  liste des systèmes — donc au démarrage.
- **Un script déposé se déclenche bien au démarrage, sans bit d'exécution.** Témoin
  posé en `-rw-r--r--`, box redémarrée, déclenché **deux fois** en une seconde :

  ```
  22:32:53 systembrowsing args=-action systembrowsing -statefile /tmp/es_state.inf -param 3do
  22:32:53 systembrowsing args=-action systembrowsing -statefile /tmp/es_state.inf -param favorites
  ```

- **Le bit d'exécution est impossible de toute façon** : le partage est monté en
  `exfat` avec `fmask=0133`. ES lance donc forcément via un interpréteur, et la
  question ne se posera jamais — y compris pour un fichier déposé depuis Windows, que
  Samba crée en `0644` (`create mask`).
- **ES ne relit pas le dossier à chaud.** Le témoin n'a rien produit à la navigation
  tant qu'ES n'avait pas redémarré. L'instruction finale doit donc inclure un
  redémarrage.

Deux conséquences directes sur le design :

1. Le script est appelé **deux fois en une seconde** au démarrage. La garde `pgrep`
   n'est pas un confort : sans elle, deux agents tournent en parallèle et dédoublent
   les sessions de jeu.
2. Comme l'évènement se répète à chaque navigation dans les menus, le même script sert
   de lanceur **et de chien de garde** : un agent mort repart au prochain passage au
   menu. C'est strictement supérieur à `custom.sh`, qui n'offrait qu'un lancement au
   démarrage.

## Architecture

Quatre pièces.

### A. Point de téléchargement — `GET /api/recalboxes/[id]/installer`

Réservé au propriétaire de la box (`canControlRecalbox`, déjà en place — c'est la même
garde que la file de commandes). Il frappe un token d'agent, l'injecte dans un
`config.json`, assemble un `.zip` à la volée et le renvoie.

Les fichiers Python sont lus **depuis le déploiement**, jamais recopiés dans un coin :
le zip contient donc toujours la version de l'agent qui correspond au cloud qui le
sert. Aucune dérive possible entre les deux.

Le zip **reproduit l'arborescence du partage**, pour que le geste soit unique :

```
system/
  sr-agent/
    agent.py
    scan_roms.py
    launch.py
    config.json        ← token, cloud_url, recalbox_id
userscripts/
  sr-agent[systembrowsing].sh
LISEZMOI.txt           ← dans la langue de l'utilisateur (en/fr)
```

L'utilisateur sélectionne `system` et `userscripts` et les glisse dans
`\\RECALBOX\share`. Windows propose de **fusionner** — il fusionne, il ne remplace
pas, et aucun de nos fichiers ne porte le nom d'un fichier existant. Aucune
destruction possible.

Dépendance nouvelle : une bibliothèque de compression (`fflate` — pur JS, sans binaire
natif, donc sans friction sur Vercel). Le projet n'en a aucune aujourd'hui.

### B. Le lanceur — `sr-agent[systembrowsing].sh`

Trois lignes : la garde `pgrep`, puis l'appel à `launch.py`. **Volontairement idiot.**

Toute l'intelligence (comparaison de versions, vérification, bascule, retour arrière)
vit dans `launch.py`, en Python. Motif : du bash sur une box distante ne se teste pas,
du Python si — l'agent a déjà 105 tests en `unittest` standard. La logique de retour
arrière ne doit pas être le seul morceau du projet qu'aucun test ne couvre.

`custom.sh` **sort du parcours d'installation** : on n'y touche plus du tout, ce qui
supprime le risque d'écrasement. Les box déjà installées via `custom.sh` continuent de
fonctionner ; l'agent détecte au démarrage qu'il a été lancé deux fois (ancien chemin
+ nouveau lanceur) et neutralise proprement l'ancien.

### C. L'assistant en 3 écrans

En mode serverless, `/recalboxes/add` devient l'assistant. En auto-hébergé, le
formulaire actuel ne bouge pas : ses cinq champs y servent réellement.

1. **Identité** — nom, emoji, couleur. Rien d'autre. Les champs techniques partent avec
   des valeurs par défaut inertes. La liste des box affiche aujourd'hui
   `recalbox.local · SSH:22 · MQTT:1883` sous chaque machine : trois informations
   fausses en serverless, masquées dans ce mode.
2. **Installation** — le bouton de téléchargement, puis les instructions **adaptées au
   système** (onglet Windows/macOS présélectionné d'après le navigateur) : ouvrir le
   zip, taper `\\RECALBOX` dans l'explorateur, glisser les deux dossiers, redémarrer la
   box.
3. **Attente** — l'écran interroge le serveur et passe au vert dès le premier appel de
   la box. Le signal existe déjà : le `lastUsedAt` du token, que
   [`lib/db/agent-liveness.ts`](../../../apps/dashboard/lib/db/agent-liveness.ts)
   agrège par box, et dont l'écriture est fiable depuis qu'elle passe par `after()`.

**L'écran 3 est un état, pas une étape.** S'il ferme l'onglet ou que la box met dix
minutes, il ne doit rien perdre : une box créée mais jamais vue s'affiche « en attente
d'installation » dans la liste, avec un lien qui y ramène. Un assistant dont on ne peut
pas sortir est un assistant dans lequel on se fait piéger.

**L'échec doit être bavard.** Au bout de ~3 minutes sans signe de vie, l'écran déroule
les causes réelles par ordre de probabilité : la box n'a pas redémarré, les dossiers
ont été déposés dans un sous-dossier au lieu de la racine du partage, la box n'a pas
accès à Internet. C'est le seul endroit du produit où l'utilisateur se retrouvera seul
face à un échec silencieux ; c'est donc celui qui mérite le plus de soin.

**Box fantôme assumée.** L'assistant crée la box avant qu'elle existe vraiment. Si
l'utilisateur abandonne à l'écran 2, une box orpheline reste dans sa liste. On
l'assume — visible, étiquetée « en attente d'installation », supprimable — plutôt que
d'inventer un état intermédiaire en base.

### D. Mise à jour automatique

**Aucune nouvelle boucle réseau.** L'agent interroge déjà la file de commandes toutes
les 60 s, et chaque interrogation est une invocation facturée
([`agent/README.md`](../../../agent/README.md)). La version courante voyage donc dans
la réponse de cette requête-là.

Séquence :

0. La version présente dans le dépôt est une constante unique (`agent/VERSION`), lue à
   la fois par le constructeur de zip et par la file de commandes : un seul endroit à
   incrémenter, et le zip ne peut pas annoncer une version différente de celle qu'il
   contient.
1. Le cloud n'annonce pas « il existe plus récent » mais **la version que cette box
   doit exécuter**. L'agent y converge, à la hausse comme à la baisse. C'est ce qui
   rend le retour arrière de parc possible : ramener la cible en arrière redescend les
   box déjà passées, alors qu'un « si plus récent » les y aurait laissées bloquées.
2. Si sa version diffère de la cible, il télécharge la bonne **à côté** de l'ancienne,
   via `GET /api/agent/download`, authentifié par son token comme toutes les routes
   agent.
3. Il la fait vérifier par Python lui-même (`py_compile`) — ça attrape un
   téléchargement tronqué ou corrompu sans rien exécuter.
4. Il conserve l'ancien fichier, met le nouveau en place, pose un témoin « mise à jour
   non confirmée », et **se relance lui-même** par `execv`.

Le `execv` est indispensable : s'il se contentait de s'arrêter en comptant sur le
lanceur, il resterait mort jusqu'à ce que l'utilisateur retourne au menu —
potentiellement des heures.

**Retour arrière.** L'agent n'efface le témoin qu'après un aller-retour réussi avec le
cloud : c'est ça, « cette version fonctionne ». Si la nouvelle version plante au
démarrage, le témoin survit ; `launch.py` le voit périmé au lancement suivant et
restaure l'ancienne. Comme le lanceur se déclenche à chaque navigation, la réparation
arrive vite, et au pire au prochain démarrage.

**La mise à jour attend qu'aucune partie ne soit en cours.** Se relancer au milieu
d'une session perdrait l'appairage début/fin, donc la session de jeu de l'utilisateur —
exactement ce qu'il est venu voir.

### E. Déploiement progressif

Le retour arrière de la pièce D protège **une** box : elle se répare toute seule si la
nouvelle version ne démarre pas. Il ne protège pas le parc — une version qui démarre
correctement mais se comporte mal passerait partout d'un coup. C'est l'objet de cette
pièce.

**Deux réglages, dans la table `settings` déjà en place** (format `scope.key`) :
`agent.targetVersion` et `agent.rolloutPercent`.

**Le tirage est déterministe.** L'appartenance d'une box au lot se calcule par hachage
de son `recalbox_id`, pas au hasard : une box tirée dans les 10 % y reste quand on
passe à 25 %. Un tirage aléatoire à chaque interrogation ferait osciller les box entre
deux versions toutes les 60 secondes.

**La montée est manuelle**, par paliers décidés depuis `/admin` : ta box d'abord, puis
un pourcentage qu'on augmente en regardant les chiffres. Pas d'automatisme — juger
qu'une version est saine demande un jugement, et une progression automatique ne ferait
que déployer une panne plus lentement.

**Deux gestes d'urgence**, et ils ne font pas la même chose :

- `rolloutPercent` à 0 — **arrête l'hémorragie**. Plus aucune box ne bascule ; celles
  déjà passées y restent.
- `targetVersion` à la version précédente — **rapatrie tout le monde**. C'est le vrai
  bouton d'annulation, et il n'existe que parce que l'agent converge vers une cible au
  lieu de suivre la version la plus récente.

**Sans visibilité, tout ceci ne sert à rien.** Un pourcentage n'a de valeur que si l'on
peut constater qu'un lot va bien. L'agent estampille donc chaque requête d'un en-tête
`X-Agent-Version`, relevé au même endroit que `lastUsedAt` — l'écriture existe déjà,
on ajoute une colonne, pas une requête. La page `/admin` en tire la seule vue qui
compte pendant un déploiement : combien de box sur chaque version, et combien d'entre
elles ont donné signe de vie dans la dernière heure. Une version dont le taux de
présence s'effondre est une version à rapatrier.

## Sécurité

- **Le zip contient un secret** : le token en clair dans `config.json`, dans le dossier
  Téléchargements de l'utilisateur. Acceptable — il ne vaut que pour sa box, il est
  révocable depuis l'interface, et le téléchargement est protégé par sa session. Mais
  le lien ne doit jamais être partageable : il est réservé au propriétaire.
- **La mise à jour automatique est, par construction, du code que le cloud fait
  exécuter sur la machine de l'utilisateur.** La frontière de confiance est déjà
  franchie : le token permet déjà d'exécuter des commandes `power`/`conf` via la file
  d'attente. L'auto-update n'élargit pas ce pouvoir, il en change la fréquence.
- **Le Web Manager de la box n'a aucune authentification** et un CORS ouvert à tous.
  Constat d'environnement, pas une décision de ce design — mais il confirme qu'il ne
  faut rien y déposer de sensible.

## Tests

| Couche | Nature |
| --- | --- |
| Constructeur de zip | Vitest — structure des chemins, token et URL corrects, fichiers Python identiques à ceux du dépôt |
| `GET .../installer` | Vitest — 401 anonyme, 403 non-propriétaire, 200 + type MIME pour le propriétaire |
| Comparaison de versions, vérification, bascule, retour arrière | `unittest` Python, dans `agent/` |
| Assistant | Vitest — la box en attente reste accessible, l'écran d'échec s'affiche après le délai |
| Tirage du lot | Vitest — déterministe pour un `recalbox_id` donné, stable quand le pourcentage monte, vide à 0 % |
| Convergence vers la cible | `unittest` Python — l'agent descend aussi bien qu'il monte |
| Bout en bout | Dépôt réel via le partage, redémarrage, l'agent appelle. La seule preuve qui compte. |

## Hors périmètre

- **L'installeur double-clic.** Gardé en réserve : un petit programme pré-configuré qui
  trouve la box et fait tout en SSH. Le plus proche du « un clic », mais binaire non
  signé = alerte SmartScreen/Gatekeeper, et trois plateformes à maintenir. À reprendre
  si le terrain montre que le glisser-déposer coince. La découverte du
  `POST /api/system/frontend/restart` lui profiterait : il remplacerait le
  « redémarre ta box » par une simple relance de l'interface.
- **Le mode auto-hébergé**, qui garde son formulaire technique.
- **L'exploitation du Web Manager**, traitée par la spec
  [2026-08-07](2026-08-07-recalbox-manager-integration-design.md).
