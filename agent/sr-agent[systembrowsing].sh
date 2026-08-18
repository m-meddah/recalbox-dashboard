#!/bin/bash
# Super-Retrogamers — lancement de l'agent.
#
# Déposé dans /recalbox/share/userscripts/. EmulationStation exécute tout fichier
# nommé *[systembrowsing].sh à chaque affichage de la liste des systèmes — donc au
# démarrage (deux fois en une seconde, mesuré) et à chaque navigation. La garde
# pgrep n'est donc pas un confort : sans elle, deux agents tournent en parallèle et
# dédoublent les sessions de jeu.
#
# Ce déclenchement répété fait aussi office de chien de garde : un agent mort repart
# au prochain passage au menu.
#
# Le partage est monté en exfat (fmask=0133) : aucun bit d'exécution n'est possible,
# ES lance donc via bash. Ne pas tenter de chmod +x, cela ne peut pas marcher.
AGENT_DIR="/recalbox/share/system/sr-agent"
pgrep -f "$AGENT_DIR/agent.py" >/dev/null 2>&1 && exit 0
nohup python3 "$AGENT_DIR/launch.py" >>"$AGENT_DIR/agent.log" 2>&1 </dev/null &
