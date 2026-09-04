#!/usr/bin/env python3
"""Mise a jour automatique de l'agent Super-Retrogamers.

Sans dependance : RecalboxOS ne fournit que Python 3 et paho-mqtt.

Ce module porte TOUTE la logique de mise a jour. agent.py s'en sert pour le
chemin avant (telecharger, verifier, basculer, confirmer), launch.py pour le
retour arriere. Il vit ici plutot que dans le script bash du lanceur parce que
du bash sur une box distante n'est pas testable — et parce que le lanceur, lui,
n'est jamais mis a jour : sa corruption serait le seul echec irrattrapable.
"""

import fcntl
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

# Le fichier de verrou d'instance unique, pose par agent.py (voir lock_path()
# la-bas) et SONDE par launch.py avant tout retour arriere. Le nom vit ici, dans
# le seul module que les deux importent, pour qu'il ne puisse pas deriver entre
# celui qui pose le verrou et celui qui le teste : deux noms differents feraient
# croire au lanceur qu'aucun agent ne tourne, et il restaurerait par-dessus un
# agent parfaitement sain.
LOCK_NAME = "launch.lock"

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
    """Ecrit un JSON de maniere atomique.

    Un `open(path, "w")` en place laisserait un JSON tronque si l'ecriture est
    coupee en plein milieu — precisement ce que le temoin existe pour
    survivre. On ecrit donc dans un fichier temporaire a cote de la cible, on
    force l'ecriture sur le disque (flush + fsync), puis on bascule avec
    os.replace, atomique au niveau du systeme de fichiers.
    """
    tmp_path = path + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(data, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, path)


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
    # Une bascule non prouvee doit etre tranchee par le lanceur AVANT qu'une
    # autre soit tentee. Ce n'est pas une optimisation : backup/ est efface puis
    # refait a partir du dossier COURANT a chaque tentative. Si une bascule a
    # echoue en cours d'os.replace, ce dossier courant est un melange des deux
    # versions ; maybe_update reessaie toutes les 60 s, donc quelques tentatives
    # a l'interieur meme du delai de grace suffisent a remplacer la derniere
    # sauvegarde saine par ce melange. Le retour arriere restaurerait alors une
    # sauvegarde empoisonnee ET blacklisterait la cible : box mixte, irreparable,
    # et exclue du correctif. Refuser ici est la seule facon de garder la
    # sauvegarde qui, elle, a demarre.
    # read_witness() returns None for both "no file at all" and "file present
    # but unreadable" — gating on it alone would let a corrupt witness through
    # as if nothing were outstanding. A witness that exists but does not parse
    # is the likely trace of a power cut mid-write on a PREVIOUS swap, not the
    # absence of one (see pending_rollback, which draws the same line). So we
    # check existence separately: present-and-unparseable still blocks.
    if os.path.exists(_witness_path(agent_dir)):
        pending = read_witness(agent_dir) or {}
        if not pending.get("confirmed"):
            return False

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
    """True quand une bascule n'a jamais fait ses preuves et a epuise son delai.

    Un fichier temoin absent n'est pas la meme chose qu'un fichier temoin
    present mais illisible. Le premier signifie qu'aucune bascule n'est en
    cours : rien a restaurer. Le second est la trace la plus probable d'une
    ecriture interrompue (coupure de courant en plein milieu du
    open(path, "w").write de _write_json, sur un ancien temoin, ou en plein
    milieu du remplacement atomique lui-meme) : c'est le signe d'une bascule
    en cours, donc on restaure. read_witness ne distingue pas les deux (les
    deux valent None), et son contrat ne doit pas changer : confirm_update et
    rollback en dependent tel quel. On verifie donc ici, en plus, l'existence
    du fichier.
    """
    path = _witness_path(agent_dir)
    if not os.path.exists(path):
        return False
    witness = read_witness(agent_dir)
    if witness is None:
        # Present mais illisible : la trace d'une ecriture interrompue, pas
        # l'absence de temoin. Restaurer est le choix sur.
        return True
    if witness.get("confirmed"):
        return False
    at = witness.get("at")
    if not isinstance(at, (int, float)):
        # Temoin illisible : on ne sait pas quand la bascule a eu lieu, donc on
        # ne peut pas lui accorder de delai. Restaurer est le choix sur.
        return True
    return (now if now is not None else time.time()) - at >= grace


def agent_is_running(agent_dir):
    """True si un agent tient deja le verrou d'instance unique.

    Sonde non bloquante du verrou pose par agent.py. Le lanceur s'en sert pour
    ne pas annuler une mise a jour saine dont seul le CLOUD est injoignable :
    confirm_update exige un aller-retour reseau, donc une box privee de reseau
    dix minutes apres une bascule serait rapatriee, et mark_failed inscrirait
    une version pourtant parfaitement valide dans failed.json — que rien
    n'efface jamais et qu'aucune commande d'admin n'atteint. La box refuserait
    cette version pour toujours, meme le reseau revenu.

    L'ordre rend la lecture fiable : le lanceur se declenche a chaque navigation
    dans les menus, donc un agent sain tient normalement ce verrou a cet
    instant ; une version qui plante au demarrage n'en tient aucun et le verrou
    est libre. Ne leve jamais : dans le doute (fichier illisible), on repond
    False, ce qui rend la main au comportement d'origine.
    """
    path = os.path.join(agent_dir, LOCK_NAME)
    if not os.path.exists(path):
        # Pas de fichier de verrou du tout : aucun agent n'a jamais demarre ici.
        # On ne le CREE pas — sonder ne doit rien laisser derriere soi.
        return False
    fd = None
    try:
        fd = os.open(path, os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            # Quelqu'un tient le verrou : un agent tourne, donc la version
            # basculee a demontre qu'elle demarre.
            return True
        # On vient de le prendre : personne ne le tenait. On le relache
        # immediatement — sonder ne doit jamais empecher l'agent de demarrer
        # juste apres, dans le execv du lanceur.
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    except OSError:
        return False
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass


def _copy_from_backup(agent_dir):
    """Copie backup/ par-dessus les fichiers courants.

    Trois issues, pas deux : None si aucune sauvegarde n'existe (rien a
    copier), True si tout a ete restaure, False si la copie a echoue en
    cours de route (carte SD pleine ou corrompue) — auquel cas certains
    fichiers sont deja restaures et d'autres non, un NOUVEL etat mixte que
    l'appelant doit savoir distinguer d'une absence de sauvegarde.
    """
    backup = _backup_path(agent_dir)
    if not os.path.isdir(backup):
        return None
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
    return _copy_from_backup(agent_dir) is True


def rollback(agent_dir):
    """Restaure la sauvegarde ET inscrit la version fautive au journal.

    Le chemin d'une bascule qui n'a jamais parle au cloud. Trois issues :

    - pas de sauvegarde du tout -> on efface le temoin et on renvoie False.
      Reessayer ne peut jamais aider, et garder le temoin redeclencherait un
      rollback sans espoir a chaque demarrage.
    - copie interrompue en cours de route -> on GARDE le temoin et on renvoie
      False. La box est dans un nouvel etat mixte ; le prochain demarrage
      doit reessayer. Effacer le temoin ici jetterait le seul signal qu'un
      nouvel essai est necessaire.
    - copie entierement reussie -> on inscrit la version fautive, on efface
      le temoin, on renvoie True.
    """
    witness = read_witness(agent_dir) or {}
    failed_version = witness.get("to")
    result = _copy_from_backup(agent_dir)
    if result is None:
        clear_witness(agent_dir)
        return False
    if result is False:
        return False
    if failed_version:
        mark_failed(agent_dir, failed_version)
    clear_witness(agent_dir)
    return True


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
    restaure, repolle, retrouve la meme cible et replante — indefiniment.

    Le journal est borne aux 10 dernieres versions : les plus anciennes sont
    silencieusement abandonnees plutot que de laisser le fichier grossir sans
    limite."""
    versions = read_failed(agent_dir)
    if version not in versions:
        versions.append(version)
    try:
        _write_json(_failed_path(agent_dir), versions[-10:])
    except OSError:
        pass


def has_failed(agent_dir, version):
    return version in read_failed(agent_dir)
