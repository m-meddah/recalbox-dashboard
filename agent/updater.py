#!/usr/bin/env python3
"""Mise a jour automatique de l'agent Super-Retrogamers.

Sans dependance : RecalboxOS ne fournit que Python 3 et paho-mqtt.

Ce module porte TOUTE la logique de mise a jour. agent.py s'en sert pour le
chemin avant (telecharger, verifier, basculer, confirmer), launch.py pour le
retour arriere. Il vit ici plutot que dans le script bash du lanceur parce que
du bash sur une box distante n'est pas testable — et parce que le lanceur, lui,
n'est jamais mis a jour : sa corruption serait le seul echec irrattrapable.
"""

import json
import os
import py_compile
import shutil
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))

# Les fichiers remplaces par une mise a jour. Jamais config.json : il porte le
# jeton de la box. Jamais le lanceur userscripts/ : il reste gele.
BUNDLE_FILES = ("agent.py", "scan_roms.py", "launch.py", "updater.py", "VERSION")

UPDATE_DIR = ".update"
BACKUP_DIR = "backup"
WITNESS_NAME = "update.json"
FAILED_NAME = "failed.json"

# Le lanceur se declenche a CHAQUE navigation dans les menus. Sans ce delai, une
# navigation dix secondes apres la bascule verrait un temoin non confirme et
# annulerait une mise a jour parfaitement saine, pendant qu'elle tourne.
GRACE_SEC = 600

# Posee par launch.py avant son execv. agent.py ne se met a jour que s'il la
# voit : une box lancee par l'ancien custom.sh, sans superviseur, n'a personne
# pour la reparer si la nouvelle version ne demarre pas.
SUPERVISED_ENV = "SR_AGENT_SUPERVISED"


def _segment(raw):
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def compare_versions(a, b):
    """Negatif si a < b, 0 si egales, positif si a > b.

    Une comparaison de chaines classerait `1.10.0` AVANT `1.9.0` : c'est
    exactement l'erreur qui ferait descendre une box en croyant la monter. Un
    segment illisible vaut 0 plutot qu'une exception — la valeur vient du
    reseau, et lever ici couperait la boucle de commandes.
    """
    pa = str(a or "").split(".")
    pb = str(b or "").split(".")
    for i in range(max(len(pa), len(pb))):
        na = _segment(pa[i]) if i < len(pa) else 0
        nb = _segment(pb[i]) if i < len(pb) else 0
        if na != nb:
            return -1 if na < nb else 1
    return 0


def read_version(agent_dir=HERE):
    """Version presente dans un dossier. `0.0.0` si le fichier manque, ce qui
    fait perdre toute comparaison a un dossier incomplet."""
    try:
        with open(os.path.join(agent_dir, "VERSION"), "r") as f:
            return f.read().strip() or "0.0.0"
    except OSError:
        return "0.0.0"


def verify_bundle(files):
    """True si le paquet est complet et que chaque .py compile.

    py_compile attrape un telechargement tronque ou corrompu SANS rien
    executer. C'est la seule barriere entre un octet perdu sur le reseau et un
    agent qui ne redemarre plus.
    """
    if not isinstance(files, dict):
        return False
    for name in BUNDLE_FILES:
        if not isinstance(files.get(name), str):
            return False
    tmp = tempfile.mkdtemp(prefix="sr-agent-verify-")
    try:
        for name in BUNDLE_FILES:
            if not name.endswith(".py"):
                continue
            path = os.path.join(tmp, name)
            with open(path, "w") as f:
                f.write(files[name])
            try:
                py_compile.compile(path, cfile=path + "c", doraise=True)
            except (py_compile.PyCompileError, SyntaxError, ValueError, OSError):
                return False
        return True
    except OSError:
        return False
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
