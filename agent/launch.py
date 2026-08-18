#!/usr/bin/env python3
"""Superviseur de l'agent Super-Retrogamers.

Aujourd'hui il ne fait qu'une chose : lancer agent.py en remplaçant son propre
processus. Il existe séparément du script shell parce que c'est ici qu'arriveront la
mise à jour automatique et le retour arriere — de la logique qui doit etre testable,
ce que du bash sur une box distante n'est pas.
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
    # execv remplace le processus courant : pas de processus superviseur qui traine,
    # et le pgrep du script shell continue de voir "agent.py" dans la ligne de commande.
    os.execv(argv[0], argv)


if __name__ == "__main__":
    main()
