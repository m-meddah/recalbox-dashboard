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
    tmp = None
    try:
        tmp = tempfile.mkdtemp(prefix="sr-agent-verify-")
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
        if tmp is not None:
            shutil.rmtree(tmp, ignore_errors=True)


def _witness_path(agent_dir):
    return os.path.join(agent_dir, WITNESS_NAME)


def _failed_path(agent_dir):
    return os.path.join(agent_dir, FAILED_NAME)


def _backup_path(agent_dir):
    return os.path.join(agent_dir, BACKUP_DIR)


def _write_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f)


def read_witness(agent_dir):
    """Le temoin de bascule, ou None s'il n'existe pas ou est illisible."""
    try:
        with open(_witness_path(agent_dir), "r") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def clear_witness(agent_dir):
    try:
        os.remove(_witness_path(agent_dir))
    except OSError:
        pass


def backup_version(agent_dir):
    """Version conservee dans backup/, ou None s'il n'y a pas de sauvegarde."""
    try:
        with open(os.path.join(_backup_path(agent_dir), "VERSION"), "r") as f:
            return f.read().strip() or None
    except OSError:
        return None


def stage_and_swap(agent_dir, files, from_version, to_version, now=None):
    """Verifie le paquet, sauvegarde l'existant, pose le temoin, bascule.

    Retourne True si la bascule a eu lieu. Aucun effet visible en cas d'echec de
    la verification : rien n'est touche tant que le paquet n'a pas compile.
    """
    if not verify_bundle(files):
        return False

    staging = os.path.join(agent_dir, UPDATE_DIR)
    shutil.rmtree(staging, ignore_errors=True)
    try:
        os.makedirs(staging)
        for name in BUNDLE_FILES:
            with open(os.path.join(staging, name), "w") as f:
                f.write(files[name])

        backup = _backup_path(agent_dir)
        shutil.rmtree(backup, ignore_errors=True)
        os.makedirs(backup)
        for name in BUNDLE_FILES:
            src = os.path.join(agent_dir, name)
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(backup, name))

        # Le temoin AVANT l'echange, jamais apres. os.replace est atomique
        # fichier par fichier, pas sur l'ensemble : une coupure de courant au
        # milieu laisse un melange des deux versions. Avec le temoin deja pose,
        # launch.py le repare ; pose apres, ce melange n'en porterait aucun et
        # la box resterait cassee sans que rien ne le sache.
        _write_json(
            _witness_path(agent_dir),
            {
                "from": from_version,
                "to": to_version,
                "at": int(now if now is not None else time.time()),
                "confirmed": False,
            },
        )

        for name in BUNDLE_FILES:
            os.replace(os.path.join(staging, name), os.path.join(agent_dir, name))
        return True
    except OSError:
        return False
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def confirm_update(agent_dir):
    """Marque le temoin confirme. True si ce marquage vient d'avoir lieu.

    Appele au premier aller-retour reussi avec le cloud : c'est la preuve la
    moins chere que cette version parle.
    """
    witness = read_witness(agent_dir)
    if not witness or witness.get("confirmed"):
        return False
    witness["confirmed"] = True
    try:
        _write_json(_witness_path(agent_dir), witness)
        return True
    except OSError:
        return False


def pending_rollback(agent_dir, now=None, grace=GRACE_SEC):
    """True quand une bascule n'a jamais fait ses preuves et a epuise son delai."""
    witness = read_witness(agent_dir)
    if not witness or witness.get("confirmed"):
        return False
    at = witness.get("at")
    if not isinstance(at, (int, float)):
        # Temoin illisible : on ne sait pas quand la bascule a eu lieu, donc on
        # ne peut pas lui accorder de delai. Restaurer est le choix sur.
        return True
    return (now if now is not None else time.time()) - at >= grace


def _copy_from_backup(agent_dir):
    backup = _backup_path(agent_dir)
    if not os.path.isdir(backup):
        return False
    try:
        for name in BUNDLE_FILES:
            src = os.path.join(backup, name)
            if os.path.exists(src):
                shutil.copy2(src, os.path.join(agent_dir, name))
        return True
    except OSError:
        return False


def restore_backup(agent_dir):
    """Restaure la sauvegarde SANS blamer la version courante.

    Le chemin d'une descente voulue par le cloud : cette version n'a pas
    echoue, on la redescend volontairement. L'inscrire au journal des echecs
    ferait refuser a la box la version qu'on vient de lui demander d'executer.
    """
    return _copy_from_backup(agent_dir)


def rollback(agent_dir):
    """Restaure la sauvegarde ET inscrit la version fautive au journal.

    Le chemin d'une bascule qui n'a jamais parle au cloud.
    """
    witness = read_witness(agent_dir) or {}
    failed_version = witness.get("to")
    ok = _copy_from_backup(agent_dir)
    if ok and failed_version:
        mark_failed(agent_dir, failed_version)
    clear_witness(agent_dir)
    return ok


def read_failed(agent_dir):
    """Versions qui ont deja echoue sur cette box. Liste vide si illisible."""
    try:
        with open(_failed_path(agent_dir), "r") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    return [v for v in data if isinstance(v, str)] if isinstance(data, list) else []


def mark_failed(agent_dir, version):
    """Inscrit une version au journal des echecs. Sans ce journal, la box
    restaure, repolle, retrouve la meme cible et replante — indefiniment."""
    versions = read_failed(agent_dir)
    if version not in versions:
        versions.append(version)
    try:
        _write_json(_failed_path(agent_dir), versions[-10:])
    except OSError:
        pass


def has_failed(agent_dir, version):
    return version in read_failed(agent_dir)
