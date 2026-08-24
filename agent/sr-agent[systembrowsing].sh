#!/bin/bash
# Super-Retrogamers — lancement de l'agent.
#
# Déposé dans /recalbox/share/userscripts/. EmulationStation exécute tout fichier
# nommé *[systembrowsing].sh à chaque affichage de la liste des systèmes — donc au
# démarrage (deux fois en une seconde, mesuré) et à chaque navigation. Ce déclenchement
# répété ne crée pas de race car agent.py prend lui-même un verrou exclusif
# (fcntl.flock()) au démarrage — une seule tentative réussira, les autres sortiront
# immédiatement sans erreur. C'est justement parce que le verrou vit dans agent.py, le
# seul fichier que TOUT chemin de démarrage exécute toujours, que l'ancien chemin
# custom.sh (qui lance agent.py directement, sans passer par launch.py) contend lui
# aussi pour ce même verrou. Ce déclenchement répété fait aussi office de chien de
# garde : un agent mort repart au prochain passage au menu.
#
# Le partage est monté en exfat (fmask=0133) : aucun bit d'exécution n'est possible,
# ES lance donc via bash. Ne pas tenter de chmod +x, cela ne peut pas marcher.
AGENT_DIR="/recalbox/share/system/sr-agent"
# Le verrou d'exclusion mutuelle (fcntl.flock()) est pris par agent.py lui-même,
# pas par launch.py : ce dernier ne fait qu'exec dans agent.py.
# Starting a second launcher is harmless — the loser exits immediately.
# Do not add a pgrep guard here: it would create false positives from scp/cat/nano
# operating on the same path, and silently disable the watchdog without logging.
nohup python3 "$AGENT_DIR/launch.py" >>"$AGENT_DIR/agent.log" 2>&1 </dev/null &
