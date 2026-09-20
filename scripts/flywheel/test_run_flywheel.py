"""Argument-only shell tests. Stub Python so regressions cannot harvest or train."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("run_flywheel.sh").resolve()


class FlywheelArgumentTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(prefix="prismos-runner-test-")
        self.addCleanup(self.fixture.cleanup)
        for command in ("python3", "python"):
            stub = Path(self.fixture.name) / command
            stub.write_text("#!/bin/sh\necho 'FORBIDDEN_PYTHON_CALL' >&2\nexit 97\n", encoding="utf-8")
            stub.chmod(0o700)
        self.env = dict(os.environ)
        self.env["PATH"] = self.fixture.name + os.pathsep + self.env.get("PATH", "")

    def parse(self, *args):
        result = subprocess.run(["/bin/bash", str(SCRIPT), *args], env=self.env,
                                capture_output=True, text=True, timeout=5, check=False)
        self.assertNotIn("FORBIDDEN_PYTHON_CALL", result.stdout + result.stderr)
        self.assertNotIn("HARVEST", result.stdout)
        self.assertNotIn("TRAIN LoRA", result.stdout)
        return result

    def test_shell_syntax(self):
        result = subprocess.run(["/bin/bash", "-n", str(SCRIPT)], env=self.env,
                                capture_output=True, text=True, timeout=5, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_help_is_safe_without_required_arguments(self):
        result = self.parse("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("--eval-base", result.stdout)
        self.assertIn("--check-args", result.stdout)

    def test_smoke_requires_explicit_evaluation_base_before_harvesting(self):
        result = self.parse("--smoke")
        self.assertEqual(result.returncode, 2)
        self.assertIn("--eval-base", result.stderr)
        self.assertIn("Nothing harvested or trained", result.stderr)

    def test_training_base_cannot_be_reused_as_evaluation_base(self):
        result = self.parse("--base", "synthetic-mlx-repository", "--check-args")
        self.assertEqual(result.returncode, 2)
        self.assertIn("--eval-base", result.stderr)

    def test_value_options_reject_missing_empty_or_flag_values(self):
        for option in ["--base", "--eval-base", "--judge", "--holdout", "--name"]:
            for values in [[], [""], [" \t "], ["--smoke"]]:
                with self.subTest(option=option, values=values):
                    result = self.parse(option, *values)
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("Missing value", result.stderr)

    def test_evaluation_base_does_not_supply_training_weights(self):
        result = self.parse("--eval-base", "synthetic-current:tag", "--check-args")
        self.assertEqual(result.returncode, 2)
        self.assertIn("Training and evaluation bases are distinct", result.stderr)

    def test_explicit_baseline_is_retained_in_argument_only_mode(self):
        result = self.parse("--smoke", "--eval-base", "synthetic-current:tag", "--check-args")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Evaluation base: synthetic-current:tag", result.stdout)
        self.assertIn("No data read, model calls, training, or promotion", result.stdout)

    def test_distinct_training_and_evaluation_bases_are_accepted(self):
        result = self.parse("--base", "synthetic-mlx-repository", "--eval-base",
                            "synthetic-app-model:tag", "--check-args")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Evaluation base: synthetic-app-model:tag", result.stdout)
        self.assertNotIn("Evaluation base: synthetic-mlx-repository", result.stdout)

    def test_unknown_option_is_rejected_before_actions(self):
        result = self.parse("--unknown-option")
        self.assertEqual(result.returncode, 2)
        self.assertIn("Unknown argument", result.stderr)


if __name__ == "__main__":
    unittest.main()
