#!/usr/bin/env python3
"""Superviseur de l'agent Super-Retrogamers.

Aujourd'hui il ne fait qu'une chose : lancer agent.py en remplaçant son propre
processus. Il existe séparément du script shell parce que c'est ici qu'arriveront la
mise à jour automatique et le retour arriere — de la logique qui doit etre testable,
ce que du bash sur une box distante n'est pas.

L'exclusion mutuelle (fcntl.flock()) vit dans agent.py, pas ici : l'ancien chemin
d'installation (custom.sh) lance agent.py directement, sans jamais passer par ce
superviseur, donc un verrou pose ici ne le verrait pas. agent.py est le seul fichier
que tous les chemins de demarrage executent toujours ; c'est donc lui qui doit
arbitrer l'exclusivite.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def agent_path():
    """Chemin de l'agent, toujours a cote de ce fichier."""
    return os.path.join(HERE, "agent.py")


def build_argv():
    """Arguments d'exec : le meme interpreteur que celui qui nous execute."""
    return [sys.executable, agent_path()]


def main():
    argv = build_argv()
    # os.execv replaces the process image entirely: no supervisor process lingers.
    # agent.py acquires the single-instance lock itself right after it starts.
    os.execv(argv[0], argv)


if __name__ == "__main__":
    main()
