import os
import sys
import unittest

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


if __name__ == "__main__":
    unittest.main()
