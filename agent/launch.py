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


def lock_path():
    """Chemin du fichier de verrou, a cote de launch.py."""
    return os.path.join(HERE, "launch.lock")


def is_process_alive(pid):
    """Verifie si un processus avec ce pid existe encore.

    Leve ProcessLookupError si le processus n'existe pas.
    """
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def acquire_lock():
    """Acquiert le verrou d'exclusivite ou retourne False si un autre agent tourne.

    Retourne True si le verrou a ete acquis, False si un autre processus le detient.
    Leve une exception en cas d'erreur irreversible (permissions, disque plein).
    """
    lockfile = lock_path()
    pid_str = str(os.getpid())

    while True:
        try:
            # Tentative d'acquisition atomique du verrou
            fd = os.open(lockfile, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, pid_str.encode())
            os.close(fd)
            return True
        except FileExistsError:
            # Le verrou existe deja. Lire le pid qu'il contient.
            try:
                with open(lockfile, "r") as f:
                    content = f.read().strip()
                if not content:
                    # Fichier vide, considere comme stale
                    os.remove(lockfile)
                    continue
                try:
                    locked_pid = int(content)
                except ValueError:
                    # Fichier corrompu, considere comme stale
                    os.remove(lockfile)
                    continue

                # Verifier si le processus qui detient le verrou est encore vivant
                if is_process_alive(locked_pid):
                    # Un agent tourne deja, s'arreter sans erreur
                    return False
                else:
                    # Le verrou est stale, le reprendre
                    os.remove(lockfile)
                    continue
            except (IOError, OSError):
                # Erreur a la lecture, considerer le verrou comme stale et recommencer
                try:
                    os.remove(lockfile)
                except (IOError, OSError):
                    pass
                continue


def main():
    # Acqurir le verrou d'exclusivite avant de lancer l'agent
    if not acquire_lock():
        # Un autre agent tourne deja, se terminer sans erreur
        sys.exit(0)

    argv = build_argv()
    # execv remplace le processus courant : pas de processus superviseur qui traine,
    # et le pgrep du script shell continue de voir "agent.py" dans la ligne de commande.
    os.execv(argv[0], argv)


if __name__ == "__main__":
    main()
