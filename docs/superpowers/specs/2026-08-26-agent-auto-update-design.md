# Mise à jour automatique de l'agent — design

**Date** : 2026-08-26
**Statut** : conception validée, prête pour le plan d'implémentation
**Précédent** : [installation plug & play](2026-08-18-agent-plug-and-play-install-design.md), pièces D et E

## Problème

L'agent s'installe désormais sans terminal : l'utilisateur télécharge un zip depuis le
dashboard, dépose deux dossiers dans le partage réseau de sa Recalbox, redémarre. Ce
chemin est vérifié sur du vrai matériel et fusionné sur `main`.

Mais il n'existe qu'une seule fois. Chaque évolution de l'agent — un correctif, un
nouveau champ, une boucle mieux cadencée — oblige aujourd'hui chaque utilisateur à
refaire ce geste. Pour le public visé, qui n'a jamais ouvert un terminal et à qui l'on
a promis du plug & play, c'est la promesse retirée un mois après.

Et l'auteur du parc n'a aucune idée de ce que les box exécutent. Rien, dans la base, ne
dit quelle version tourne où.

## Objectif

L'agent converge tout seul vers la version que le cloud lui désigne, se répare s'il ne
démarre plus, et le parc se déploie par paliers observables — sans qu'aucun utilisateur
n'ait à toucher à quoi que ce soit.

## La contrainte que le cloud impose

**Le cloud ne dispose que d'une seule version de l'agent : celle du déploiement en
cours.** `readAgentPayload()` lit soit `agent/` dans l'arbre source, soit
`agent-payload/` généré au build — deux copies du même commit. Il n'existe aucun stock
des versions passées.

La pièce E de la spec du 18/08 décrivait pourtant `agent.targetVersion` comme un bouton
d'annulation de parc : « ramener la cible en arrière redescend les box déjà passées ».
Le serveur ne peut pas tenir cette promesse — si la prod tourne en 1.1.0, il n'a plus
les octets de la 1.0.0 à envoyer.

**Décision : la sauvegarde vit sur la box.** Chaque box conserve le paquet précédent.
Quand la cible annoncée correspond à cette sauvegarde, elle restaure localement, sans
rien télécharger. Une seule marche de profondeur — celle qui compte, celle qui ramène à
la version qui fonctionnait il y a une heure.

Le coût est quasi nul : ce fichier de sauvegarde doit de toute façon exister pour le
retour arrière automatique d'une box qui ne démarre plus. Au-delà d'une marche, on
annule par redéploiement (`vercel rollback` est instantané et ne reconstruit rien).

Les deux alternatives écartées : une bibliothèque de versions dans le stockage objet
(profondeur illimitée, mais une étape de publication au déploiement, une politique de
rétention, et une dépendance au blob) ; et aucun retour arrière de parc du tout (le
plus simple, mais une version qui démarre bien et se comporte mal resterait en place
jusqu'au redéploiement).

## Architecture

### A. Le protocole

**Aucune nouvelle boucle réseau.** L'agent interroge déjà `GET /api/agent/commands`
toutes les 60 s, et chaque interrogation est une invocation facturée. La cible voyage
dans cette réponse-là :

```json
{ "commands": [...], "agent": { "target_version": "1.1.0" } }
```

`target_version: null` veut dire « aucune instruction » : la box garde ce qu'elle
exécute. C'est ce que reçoit une box hors du lot. Snake case, comme tout le reste du
protocole agent (`rom_path`, `captured_at`, `duration_seconds`).

**La version courante vient de l'en-tête de la requête elle-même**, pas d'une lecture en
base : l'agent l'estampille sur cette interrogation-là, c'est la valeur la plus fraîche
possible, et ça évite une requête sur le chemin de réponse. En son absence — un agent
antérieur à ce mécanisme — la résolution rend `null` : sans connaître le point de
départ on ne peut pas distinguer une montée d'une descente, et un agent trop ancien pour
déclarer sa version est de toute façon trop ancien pour comprendre le champ.

**Dans l'autre sens**, l'agent estampille chaque requête d'un en-tête
`X-Agent-Version`. Le serveur le note dans `touchLastUsed()` de `lib/db/agent-queries.ts`,
la mise à jour qui existe déjà à chaque interrogation : une colonne, pas une requête.

**Trois entrées, une seule fonction de résolution.**

| Entrée | Où | Défaut |
| --- | --- | --- |
| `agentChannel` | colonne sur `recalboxes` | `stable` |
| `agent.targetVersion` | table `settings` | la version déployée |
| `agent.rolloutPercent` | table `settings` | `0` |

```
resolveTargetVersion(canal, recalboxId, versionCourante, cible, pourcentage)

  cible == versionCourante   → null      rien à dire
  cible <  versionCourante   → cible     une descente n'est jamais filtrée
  canal == 'beta'            → cible
  bucket(recalboxId) < pourcentage → cible
  sinon                      → null
```

`bucket` = les quatre premiers octets de `sha256(recalboxId)` modulo 100. Le tirage est
déterministe : une box tirée dans les 10 % y reste quand on passe à 25 %. Un tirage
aléatoire à chaque interrogation ferait osciller les box entre deux versions toutes les
60 secondes.

**La troisième ligne s'écarte de la spec du 18/08, délibérément.** Le pourcentage
protège une montée ; une descente n'a pas besoin d'être protégée, elle *est* la
protection. Sans cette règle, rapatrier le parc demanderait deux gestes coordonnés —
remettre la cible en arrière **et** remonter le pourcentage à 100 — et un bouton
d'urgence qui demande deux gestes n'en est pas un.

Les deux gestes d'urgence gardent donc les rôles que la spec précédente leur donnait,
mais l'un devient réellement atteignable :

- `rolloutPercent` à 0 — **arrête l'hémorragie**. Plus aucune box ne bascule ; celles
  déjà passées y restent.
- `targetVersion` à la version précédente — **rapatrie tout le monde**, immédiatement,
  quel que soit le pourcentage.

La comparaison de versions s'écrit deux fois — TypeScript côté serveur, Python côté
agent — avec la même règle et des tests des deux côtés. Le serveur lit `agent/VERSION`
seul, mémoïsé par processus : `readAgentPayload()` charge 80 Ko de Python, ce qu'on ne
veut pas faire à chaque interrogation de chaque box.

### B. Le paquet et sa route

`GET /api/agent/download`, authentifiée par le même jeton Bearer que les autres routes
agent, rend le paquet du déploiement en cours :

```json
{ "version": "1.1.0", "files": { "agent.py": "...", "scan_roms.py": "...", ... } }
```

Environ 90 Ko de JSON, demandés une fois par version et par box. Du JSON plutôt qu'un
zip : sans dépendance des deux côtés, et sans étape de décompression à vérifier.

Le paquet contient `agent.py`, `scan_roms.py`, `launch.py`, `updater.py` et `VERSION`.
Jamais `config.json` — il porte le jeton de la box.

**`userscripts/sr-agent[systembrowsing].sh` n'en fait pas partie.** C'est le seul
fichier dont la corruption est irrattrapable : plus de lanceur, plus d'agent, plus
jamais — il faudrait refaire le glisser-déposer. Et c'est exactement la raison d'être de
`launch.py`, dont le docstring le dit déjà : la logique testable vit en Python parce que
du bash sur une box distante ne l'est pas. **Le bash reste gelé, tout le Python est
remplaçable.** Si le lanceur devait changer un jour, ce serait une nouvelle
installation, pas une mise à jour.

### C. La bascule sur la box

Un nouveau module `agent/updater.py` porte toute la logique, en fonctions pures et
testables. `agent.py` s'en sert pour le chemin avant, `launch.py` pour le retour
arrière.

Dans la boucle de commandes, une fois la cible résolue et différente de la version
courante :

```
1. Une partie en cours, ou un scan de ROMs ?   → on repasse dans 60 s
2. Télécharger dans sr-agent/.update/           (même système de fichiers → renommage atomique)
3. py_compile sur chaque .py                    → échec : on efface, backoff, on retente
4. Déplacer les fichiers actuels vers backup/   (avec leur VERSION)
5. Renommer les neufs en place
6. Écrire le témoin update.json                 {from, to, at, confirmed: false}
7. Fermer le descripteur du verrou, execv
```

`py_compile` attrape un téléchargement tronqué ou corrompu sans rien exécuter.

L'étape 1 ne demande aucun nouvel état : `SessionTracker` sait déjà si une partie est
ouverte, et le verrou de scan existant (`wait_for_scan`) dit si un balayage de ROMs
tourne. Un `execv` au milieu d'un scan le perdrait.

**L'étape 1 n'a pas de délai maximal.** Se relancer au milieu d'une partie perdrait
l'appairage début/fin, donc la session que l'utilisateur est venu voir. Une box qui joue
en permanence est une box qui finira par s'arrêter.

**L'`execv` est indispensable.** Si l'agent se contentait de s'arrêter en comptant sur
le lanceur, il resterait mort jusqu'à ce que l'utilisateur retourne au menu —
potentiellement des heures.

#### Le piège du verrou

`agent.py` fait aujourd'hui `os.set_inheritable(fd, True)` sur le descripteur du verrou,
avec ce commentaire : « survit à execv, au cas où ce processus serait lui-même exec'é —
gratuit à garder puisqu'il n'exec plus vers rien ».

**L'auto-update casse exactement cette prémisse.** Après `execv`, le descripteur hérité
tient toujours `LOCK_EX` ; le nouvel agent ouvre un descripteur neuf sur le même
fichier, et `flock()` arbitre entre *descriptions de fichier ouvert*, pas entre
processus — il se refuse donc le verrou à lui-même, journalise « un autre agent tient
déjà le verrou », et sort. L'agent se suiciderait à chaque mise à jour, ne reviendrait
qu'à la prochaine navigation dans les menus, et le témoin non confirmé provoquerait un
retour arrière. **Toutes les mises à jour échoueraient.**

Le correctif : fermer le descripteur juste avant `execv`, et corriger le commentaire qui
induira sinon en erreur le prochain lecteur.

Pas de le transmettre au nouveau processus : ce serait coupler l'ancienne version et la
nouvelle à une convention partagée, et une version qui ne la connaît pas ne démarrerait
plus. **Une mise à jour doit rester indépendante des versions qu'elle relie.** La
fenêtre ouverte par la fermeture dure quelques microsecondes, et si un lanceur s'y
glissait, le prochain passage au menu répare.

### D. Le retour arrière

Le nouvel agent marque le témoin `confirmed` à sa première interrogation réussie du
cloud — le même aller-retour qui porte déjà `target_version`. C'est la preuve la moins
chère que cette version parle.

`launch.py`, avant d'exécuter :

| Témoin | Action |
| --- | --- |
| absent | rien |
| confirmé | il l'efface |
| non confirmé, moins de 10 min | il passe |
| non confirmé, 10 min ou plus | il restaure `backup/` et efface le témoin |

**Le délai de grâce est indispensable, et c'est le lanceur qui l'impose** : il se
déclenche à *chaque* navigation dans les menus. Sans lui, une navigation dix secondes
après la bascule verrait un témoin non confirmé et annulerait une mise à jour
parfaitement saine — pendant qu'elle tourne, en échangeant des fichiers sous un
processus vivant. Dix minutes, c'est bien plus que les quelques secondes qu'il faut à un
agent sain pour atteindre sa première interrogation, et bien moins que la patience d'un
utilisateur.

`launch.py` importe `updater.py` dans un `try/except` qui, en cas d'échec, exécute
`agent.py` quand même. Un `updater.py` cassé ne doit pas pouvoir empêcher le démarrage.

#### Deux garde-fous

**On ne met à jour que là où on sait réparer.** `launch.py` pose une variable
d'environnement avant son `execv` ; `agent.py` ne se met à jour que s'il la voit. Une
box encore sur l'ancien chemin `custom.sh`, qui lance `agent.py` directement, ne l'aura
jamais — et c'est bien ainsi, puisque rien ne l'y réparerait. `os.execv` hérite de
l'environnement, donc la variable survit à la relance déclenchée par une mise à jour.

**Une seule marche de recul, et elle est visible.** Si la cible est une version dont la
box n'a pas la sauvegarde — box en 1.2.0, sauvegarde en 1.1.0, cible en 1.0.0 — elle ne
peut pas obéir. Elle le journalise, reste où elle est, et continue de déclarer sa
version : `/admin` la montrera bloquée. C'est la limite qu'on a acceptée en choisissant
la sauvegarde locale ; elle doit apparaître plutôt que se taire.

### E. Le déploiement progressif

**La montée est manuelle**, par paliers décidés depuis `/admin` : les box `beta`
d'abord, puis un pourcentage qu'on augmente en regardant les chiffres. Pas
d'automatisme — juger qu'une version est saine demande un jugement, et une progression
automatique ne ferait que déployer une panne plus lentement.

**Le canal est explicite, pas tiré au sort.** Chaque Recalbox porte `stable` ou `beta` ;
les `beta` prennent toujours la cible immédiatement, quel que soit le pourcentage. C'est
ce qui permet de mettre sa propre box en première ligne et celle d'un utilisateur en
retrait, sans dépendre d'un tirage qui pourrait décider l'inverse.

### F. La visibilité et les commandes d'admin

**Sans visibilité, tout ceci ne sert à rien.** Un pourcentage n'a de valeur que si l'on
peut constater qu'un lot va bien.

Une section dans `/admin`, à côté des invitations, montre le seul tableau qui compte
pendant un déploiement :

```
Version            Box    Vues dans l'heure
1.1.0 (déployée)     3                    3
1.0.0               12                   11
```

Une version dont le taux de présence s'effondre est une version à rapatrier.

**La cible n'est pas un champ libre, c'est une liste.** Elle contient la version
déployée, plus toute autre version qu'au moins une box déclare réellement exécuter. Un
champ texte laisserait saisir `1.1.O`, ou une version qui n'existe nulle part : le parc
entier chercherait à converger vers du néant, et comme personne n'y arriverait, rien ne
bougerait — une panne parfaitement silencieuse. La liste rend cette faute impossible
sans rien coûter, puisqu'elle se construit à partir de la télémétrie qu'on vient
d'ajouter.

Le pourcentage se règle par paliers cliquables — 0, 10, 25, 50, 100 — plutôt qu'au
clavier : les deux gestes d'urgence deviennent atteignables en un clic.

Le canal se choisit sur la page d'édition de la box, où l'on gère déjà ses jetons.

**Routes** : `GET`/`PUT /api/agent-rollout`, gardées par `isAdmin` sur le modèle de
`app/api/invitations/route.ts`. Au premier niveau, **pas sous `/api/agent/`** : ce
préfixe désigne les routes authentifiées par jeton de machine, et y glisser une route à
session humaine invite à confondre les deux modèles d'authentification.

## Ce qui change dans le code existant

| Fichier | Changement |
| --- | --- |
| `agent/agent.py` | ferme le descripteur du verrou avant `execv` ; en-tête `X-Agent-Version` ; garde d'environnement ; appel à `updater` depuis `command_loop` |
| `agent/launch.py` | vérification du témoin et retour arrière ; pose la variable d'environnement |
| `agent/updater.py` | **nouveau** — comparaison, téléchargement, vérification, bascule, témoin, restauration |
| `agent/VERSION` | passe à `1.1.0` au premier déploiement qui embarque ce mécanisme |
| `lib/agent/installer-zip.ts` | le zip embarque `VERSION` et `updater.py` |
| `lib/agent/payload.ts` | lit `updater.py` ; `readAgentVersion()` mémoïsée |
| `scripts/copy-agent-payload.mjs`, `next.config.ts` | les trois listes de fichiers restent synchronisées |
| `lib/db/schema.ts` | `agent_tokens.agent_version`, `recalboxes.agent_channel` |
| `lib/db/agent-queries.ts` | `touchLastUsed()` écrit la version |
| `app/api/agent/commands/route.ts` | ajoute `agent.target_version` à la réponse |
| `app/api/recalboxes/[id]/route.ts` | `agentChannel` dans `updateSchema` |

## Sécurité

- **L'auto-update est, par construction, du code que le cloud fait exécuter sur la
  machine de l'utilisateur.** La frontière de confiance est déjà franchie : le jeton
  permet déjà d'exécuter des commandes `power`/`conf` via la file d'attente.
  L'auto-update n'élargit pas ce pouvoir, il en change la fréquence.
- La route de téléchargement est authentifiée par le jeton de machine, comme toutes les
  routes agent. Elle ne sert que des fichiers du dépôt, jamais un chemin fourni par
  l'appelant.
- Les commandes de déploiement sont réservées aux administrateurs, et le canal d'une box
  au propriétaire de cette box.

## Tests

| Couche | Nature |
| --- | --- |
| `resolveTargetVersion` | Vitest — `null` à versions égales, descente non filtrée par le pourcentage, `beta` toujours servi, seau stable quand le pourcentage monte, lot vide à 0 |
| Comparaison de versions | Vitest **et** `unittest` — la même table de cas des deux côtés |
| `GET /api/agent/download` | Vitest — 401 anonyme, 200 et les cinq fichiers pour un jeton valide |
| `GET /api/agent/commands` | Vitest — le champ apparaît et disparaît selon la résolution |
| Télémétrie | Vitest — l'en-tête atterrit dans la colonne |
| `updater.py` | `unittest` — fichier tronqué refusé, sauvegarde conservée, témoin confirmé, restauration après le délai de grâce et jamais dedans |
| Verrou et `execv` | `unittest` avec un **vrai sous-processus** : l'agent relancé obtient le verrou. Seul test capable d'attraper le descripteur hérité — le comportement vient du noyau, aucune simulation ne le voit |
| `/api/agent-rollout` | Vitest — 401 anonyme, 403 non-admin, liste de cibles construite depuis la télémétrie |
| Bout en bout | Déployer une 1.0.1, regarder une vraie box se mettre à jour seule, puis forcer le rapatriement. La seule preuve qui compte |

## Hors périmètre

- **La mise à jour du lanceur `userscripts/`.** Gelée par conception (pièce B).
- **Une bibliothèque de versions côté serveur.** Écartée au profit de la sauvegarde
  locale ; à reprendre si une profondeur de plus d'une marche devient nécessaire.
- **La progression automatique du pourcentage.** Un jugement humain, pas une horloge.
- **Le signalement des échecs de mise à jour au cloud.** Une box qui échoue reste sur son
  ancienne version et continue de la déclarer : `/admin` la montre bloquée. Une route de
  plus pour un signal qu'on a déjà.
