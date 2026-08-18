import os
import sys
import unittest
import tempfile
import shutil
import multiprocessing
import time

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
        shutil.rmtree(self.temp_dir, ignore_errors=True)
        launch.lock_path = self.original_lock_path

    def test_free_lock_is_acquired(self):
        """Un verrou libre doit etre acquis avec succes."""
        acquired, lock_fd = launch.acquire_lock()
        self.assertTrue(acquired)
        self.assertIsNotNone(lock_fd)
        # Verifier que le fichier de verrou existe
        self.assertTrue(os.path.exists(os.path.join(self.temp_dir, "launch.lock")))
        # Verifier qu'il contient le pid courant (pour le debug)
        with open(os.path.join(self.temp_dir, "launch.lock"), "r") as f:
            content = f.read().strip()
        self.assertEqual(content, str(os.getpid()))
        os.close(lock_fd)

    def test_second_caller_while_first_holds_lock_gets_false(self):
        """Un deuxieme appelant tandis que le premier tient le verrou doit obtenir False."""
        acquired1, lock_fd1 = launch.acquire_lock()
        self.assertTrue(acquired1)
        self.assertIsNotNone(lock_fd1)

        # Tenter d'acquerir le verrou alors qu'il est deja tenu
        acquired2, lock_fd2 = launch.acquire_lock()
        self.assertFalse(acquired2)
        self.assertIsNone(lock_fd2)

        os.close(lock_fd1)

    def test_lock_is_acquirable_again_after_holder_exits(self):
        """Le verrou doit etre acquirable apres que le titulaire ait ferme le fd."""
        acquired1, lock_fd1 = launch.acquire_lock()
        self.assertTrue(acquired1)
        self.assertIsNotNone(lock_fd1)

        # Fermer le fd (simule la mort du processus titulaire)
        os.close(lock_fd1)

        # Tenter d'acquerir le verrou a nouveau — doit reussir car le noyau
        # a automatiquement libere le verrou quand le fd a ete ferme
        acquired2, lock_fd2 = launch.acquire_lock()
        self.assertTrue(acquired2)
        self.assertIsNotNone(lock_fd2)

        os.close(lock_fd2)

    @staticmethod
    def _worker_acquire_lock(result_queue):
        """Fonction worker pour test de concurrence: tente d'acquerir le verrou."""
        acquired, lock_fd = launch.acquire_lock()
        result_queue.put({"acquired": acquired, "pid": os.getpid()})
        if acquired and lock_fd is not None:
            # Garder le verrou pendant 0.2 secondes pour permettre a d'autres
            # callers de tenter l'acquisition
            time.sleep(0.2)
            os.close(lock_fd)

    def test_exactly_one_caller_among_many_gets_lock(self):
        """Exactement un appelant parmi N doit acquerir le verrou."""
        num_callers = 5
        result_queue = multiprocessing.Queue()

        # Lancer N processus qui tentent tous d'acquerir le verrou
        processes = []
        for _ in range(num_callers):
            p = multiprocessing.Process(
                target=TestLocking._worker_acquire_lock, args=(result_queue,)
            )
            p.start()
            processes.append(p)

        # Attendre que tous les processus se terminent
        for p in processes:
            p.join(timeout=5)

        # Collecter les resultats
        results = []
        while not result_queue.empty():
            results.append(result_queue.get())

        # Verifier qu'exactement un processus a acquis le verrou
        acquired_count = sum(1 for r in results if r["acquired"])
        self.assertEqual(
            acquired_count, 1, f"Expected 1 lock holder, got {acquired_count}"
        )
        # Verifier que tous les autres ont obtenu False
        failed_count = sum(1 for r in results if not r["acquired"])
        self.assertEqual(failed_count, num_callers - 1)


if __name__ == "__main__":
    unittest.main()
