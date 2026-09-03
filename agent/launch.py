#!/usr/bin/env python3
"""Superviseur de l'agent Super-Retrogamers.

Deux responsabilites, dans cet ordre :

1. Verifier qu'une mise a jour precedente a fait ses preuves, et restaurer la
   version anterieure si elle n'en a jamais donne. Le lanceur se declenche a
   chaque navigation dans les menus, ce qui fait de cette verification une
   reparation rapide plutot qu'un rendez-vous au prochain demarrage.
2. Lancer agent.py en remplacant son propre processus.

Cette logique vit en Python et pas dans le script bash du lanceur parce que du
bash sur une box distante n'est pas testable — et parce que le lanceur, lui,
n'est jamais mis a jour : sa corruption serait le seul echec irrattrapable.

L'exclusion mutuelle (fcntl.flock()) vit dans agent.py, pas ici : l'ancien
chemin d'installation (custom.sh) lance agent.py directement, sans jamais
passer par ce superviseur, donc un verrou pose ici ne le verrait pas.
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


def supervise(agent_dir):
    """Repare une mise a jour qui n'a jamais fait ses preuves. Ne leve jamais.

    L'import d'updater est protege : un updater.py casse ne doit pas pouvoir
    empecher l'agent de demarrer. C'est le seul endroit du systeme ou une
    exception se traduirait par une box definitivement muette.
    """
    try:
        sys.path.insert(0, agent_dir)
        import updater

        witness = updater.read_witness(agent_dir)
        if witness is None:
            return
        if witness.get("confirmed"):
            updater.clear_witness(agent_dir)
            return
        if updater.pending_rollback(agent_dir):
            updater.rollback(agent_dir)
    except Exception as e:  # noqa: BLE001 — starting the agent outranks everything
        sys.stderr.write("supervise: skipped (%s)\n" % e)


def main():
    supervise(HERE)
    # Marque cette execution comme supervisee : agent.py ne se met a jour que
    # s'il voit cette variable, parce qu'une box lancee par l'ancien custom.sh
    # n'a personne pour la reparer si la nouvelle version ne demarre pas.
    # os.execv herite de l'environnement, donc elle survit aussi au redemarrage
    # que l'agent declenche lui-meme apres une bascule.
    os.environ["SR_AGENT_SUPERVISED"] = "1"
    argv = build_argv()
    # os.execv replaces the process image entirely: no supervisor process lingers.
    # agent.py acquires the single-instance lock itself right after it starts.
    os.execv(argv[0], argv)


if __name__ == "__main__":
    main()
