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

        # Pas de pre-verification sur read_witness ici. Elle rend le meme None
        # pour « aucun fichier » et pour « fichier present mais illisible »,
        # alors que pending_rollback distingue justement les deux et restaure
        # dans le second cas : un temoin corrompu est la trace d'une ecriture
        # interrompue, donc d'une bascule en cours. Filtrer sur read_witness
        # rendait cette branche-la inatteignable depuis le seul appelant reel.
        witness = updater.read_witness(agent_dir)
        if witness and witness.get("confirmed"):
            updater.clear_witness(agent_dir)
            return
        if not updater.pending_rollback(agent_dir):
            return
        if updater.agent_is_running(agent_dir):
            # Le temoin n'a jamais ete confirme, mais un agent tient le verrou :
            # la version basculee demarre, c'est le CLOUD qui est injoignable.
            # Restaurer ici rapatrierait une version saine et l'inscrirait dans
            # failed.json, que rien n'efface jamais — la box la refuserait pour
            # toujours, meme le reseau revenu. On laisse tourner ; le temoin
            # reste, et la premiere interrogation reussie le confirmera.
            sys.stderr.write("supervise: unproven update but an agent holds the lock; leaving it\n")
            return
        updater.rollback(agent_dir)
    except Exception as e:  # noqa: BLE001 — starting the agent outranks everything
        sys.stderr.write("supervise: skipped (%s)\n" % e)


def trim_log(agent_dir):
    """Ramene agent.log sous son plafond. Ne leve jamais.

    Appele ici parce que le lanceur se declenche a chaque navigation dans les
    menus : c'est la minuterie naturelle de la box, et elle ne coute rien. La
    logique, elle, vit dans updater.py et non ici, pour pouvoir etre corrigee
    par une mise a jour — le lanceur, lui, n'est jamais remplace.
    """
    try:
        sys.path.insert(0, agent_dir)
        import updater

        updater.trim_log(agent_dir)
    except Exception as e:  # noqa: BLE001 — un journal recalcitrant n'empeche pas de demarrer
        sys.stderr.write("trim_log: skipped (%s)\n" % e)


def main():
    supervise(HERE)
    # Apres supervise() : une reparation en attente prime sur l'entretien du journal.
    trim_log(HERE)
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
