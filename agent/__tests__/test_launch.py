import os
import sys
import unittest
import tempfile
import shutil

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import launch


class TestAgentPath(unittest.TestCase):
    def test_agent_path_sits_next_to_launcher(self):
        self.assertTrue(launch.agent_path().endswith("agent.py"))
        self.assertEqual(
            os.path.dirname(launch.agent_path()),
            os.path.dirname(os.path.abspath(launch.__file__)),
        )

    def test_build_argv_runs_the_agent_with_the_current_interpreter(self):
        argv = launch.build_argv()
        self.assertEqual(argv[0], sys.executable)
        self.assertTrue(argv[1].endswith("agent.py"))


class TestLocking(unittest.TestCase):
    def setUp(self):
        """Creer un repertoire temporaire pour les verrous de test."""
        self.temp_dir = tempfile.mkdtemp()
        self.original_lock_path = launch.lock_path
        # Remplacer lock_path() par une version qui utilise le temp dir
        launch.lock_path = lambda: os.path.join(self.temp_dir, "launch.lock")

    def tearDown(self):
        """Nettoyer le repertoire temporaire et restaurer lock_path."""
        shutil.rmtree(self.temp_dir)
        launch.lock_path = self.original_lock_path

    def test_free_lock_is_acquired(self):
        """Un verrou libre doit etre acquis avec succes."""
        result = launch.acquire_lock()
        self.assertTrue(result)
        # Verifier que le fichier de verrou existe
        self.assertTrue(os.path.exists(os.path.join(self.temp_dir, "launch.lock")))
        # Verifier qu'il contient le pid courant
        with open(os.path.join(self.temp_dir, "launch.lock"), "r") as f:
            content = f.read().strip()
        self.assertEqual(content, str(os.getpid()))

    def test_lock_held_by_live_pid_causes_quiet_exit(self):
        """Un verrou detenu par un processus vivant doit causer une sortie silencieuse."""
        # Creer un verrou avec le pid courant
        lockfile = os.path.join(self.temp_dir, "launch.lock")
        with open(lockfile, "w") as f:
            f.write(str(os.getpid()))

        # Tenter d'acquerir le verrou avec la meme fonction
        result = launch.acquire_lock()
        self.assertFalse(result)

    def test_stale_lock_with_dead_pid_is_taken_over(self):
        """Un verrou stale (processus mort) doit etre repris."""
        # Creer un verrou avec un pid qui n'existe pas
        # On utilise un pid tres eleve qui ne peut pas exister
        dead_pid = 99999999
        lockfile = os.path.join(self.temp_dir, "launch.lock")
        with open(lockfile, "w") as f:
            f.write(str(dead_pid))

        # Tenter d'acquerir le verrou
        result = launch.acquire_lock()
        self.assertTrue(result)
        # Verifier que le verrou contient maintenant le pid courant
        with open(lockfile, "r") as f:
            content = f.read().strip()
        self.assertEqual(content, str(os.getpid()))

    def test_empty_lock_file_is_taken_over(self):
        """Un fichier de verrou vide doit etre considere comme stale et repris."""
        lockfile = os.path.join(self.temp_dir, "launch.lock")
        with open(lockfile, "w") as f:
            f.write("")

        result = launch.acquire_lock()
        self.assertTrue(result)
        with open(lockfile, "r") as f:
            content = f.read().strip()
        self.assertEqual(content, str(os.getpid()))

    def test_corrupt_lock_file_is_taken_over(self):
        """Un fichier de verrou corrompu (non-entier) doit etre considere comme stale."""
        lockfile = os.path.join(self.temp_dir, "launch.lock")
        with open(lockfile, "w") as f:
            f.write("not_a_number_at_all")

        result = launch.acquire_lock()
        self.assertTrue(result)
        with open(lockfile, "r") as f:
            content = f.read().strip()
        self.assertEqual(content, str(os.getpid()))


if __name__ == "__main__":
    unittest.main()
