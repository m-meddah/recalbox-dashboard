#!/usr/bin/env python3
"""Superviseur de l'agent Super-Retrogamers.

Aujourd'hui il ne fait qu'une chose : lancer agent.py en remplaçant son propre
processus. Il existe séparément du script shell parce que c'est ici qu'arriveront la
mise à jour automatique et le retour arriere — de la logique qui doit etre testable,
ce que du bash sur une box distante n'est pas.
"""

import fcntl
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


def acquire_lock():
    """Acquiert le verrou d'exclusivite kernel-arbitre ou retourne (False, None).

    Utilise fcntl.flock() pour une exclusivite sans race conditions de type TOCTOU.
    Le verrou est automatiquement libere si le processus meurt (crash, kill, power cut).

    Retourne (True, fd) si le verrou a ete acquis (fd doit rester ouvert pour que
    le verrou persiste a travers execv). Retourne (False, None) si un autre processus
    tient deja le verrou.
    """
    lockfile = lock_path()
    try:
        fd = os.open(lockfile, os.O_CREAT | os.O_RDWR, 0o644)
        # MUST survive execv — Python sets close-on-exec by default (PEP 446)
        os.set_inheritable(fd, True)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            # Another agent holds the lock
            os.close(fd)
            return (False, None)
        # Lock acquired — write pid for debugging (but correctness never depends on it)
        os.lseek(fd, 0, os.SEEK_SET)
        os.ftruncate(fd, 0)
        os.write(fd, str(os.getpid()).encode())
        # DO NOT close fd, DO NOT delete the file — the lock must persist across execv
        return (True, fd)
    except OSError:
        return (False, None)


def main():
    acquired, lock_fd = acquire_lock()
    if not acquired:
        # Another agent holds the lock, exit quietly
        sys.exit(0)

    argv = build_argv()
    # lock_fd is now inheritable and will survive execv.
    # Keep lock_fd referenced so it is not garbage-collected before execv.
    # execv replaces the process: no superviseur process lingers, and the shell's
    # pgrep continues to see "agent.py" in the command line.
    os.execv(argv[0], argv)


if __name__ == "__main__":
    main()
