"""Synthetic, offline regression tests. Never reads the private corpus or calls a model."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import eval_gate as gate


class EvalGateTests(unittest.TestCase):
    def setUp(self):
        self.network = patch.object(gate._OPENER, "open", side_effect=AssertionError("network forbidden in tests"))
        self.network.start()
        self.addCleanup(self.network.stop)

    def test_exact_is_normalized_equality_not_substring(self):
        self.assertTrue(gate.exact_match("  FORTY\n Two  ", "forty two"))
        self.assertFalse(gate.exact_match("142", "42"))
        self.assertFalse(gate.exact_match("42, but actually 43", "42"))
        self.assertFalse(gate.exact_match("The answer is 42", "42"))
        self.assertFalse(gate.exact_match("", "42"))

    def test_exact_requires_nonempty_text_reference(self):
        for reference in ["", " \n ", None, 42, [], {}]:
            with self.subTest(reference=reference), self.assertRaises(ValueError):
                gate.exact_match("42", reference)

    def test_judge_requires_explicit_single_verdict(self):
        for raw, expected in [("A", "A"), (" b\n", "B"), ("tie", "TIE")]:
            self.assertEqual(gate.parse_judge(raw), expected)
        for output in ["", " ", None, {}, "Answer A", "B because it is better", "A or B", "TIE.", "<think>A</think>", "unknown"]:
            with self.subTest(output=output), self.assertRaises(ValueError):
                gate.parse_judge(output)

    def test_incomplete_or_malformed_model_envelopes_are_rejected(self):
        payloads = [
            {}, {"done": False, "message": {"content": "A"}},
            {"done": True, "done_reason": "length", "message": {"content": "A"}},
            {"done": True, "message": {"content": ""}},
            {"done": True, "message": []},
        ]
        for payload in payloads:
            with self.subTest(payload=payload), patch.object(gate._OPENER, "open") as request:
                request.return_value.__enter__.return_value.read.return_value = json.dumps(payload).encode()
                with self.assertRaises(ValueError):
                    gate.chat("synthetic-model", "synthetic question")
        with patch.object(gate._OPENER, "open") as request:
            request.return_value.__enter__.return_value.read.return_value = json.dumps({
                "done": True, "done_reason": "stop", "message": {"content": " A "},
            }).encode()
            self.assertEqual(gate.chat("synthetic-model", "synthetic question"), "A")
            self.assertEqual(request.call_args.args[0].full_url, "http://127.0.0.1:11434/api/chat")

    def test_local_endpoint_cannot_redirect_private_holdout_data(self):
        with self.assertRaises(ValueError):
            gate.NoRedirect().redirect_request(None, None, 307, "redirect", {}, "https://example.com/")
        proxies = [handler for handler in gate._OPENER.handlers if isinstance(handler, gate.urllib.request.ProxyHandler)]
        self.assertTrue(all(not handler.proxies for handler in proxies))

    def test_margin_rejects_negative_and_nonfinite_values(self):
        for margin in [-0.1, float("nan"), float("inf"), -float("inf"), "garbage"]:
            with self.subTest(margin=margin), self.assertRaises(ValueError):
                gate.promotion_margin(margin)
        self.assertEqual(gate.promotion_margin(0), 0)
        self.assertEqual(gate.promotion_margin("0.05"), 0.05)

    def test_entire_holdout_is_validated_before_inference(self):
        cases = [[], None, [{"question": ""}], [{"question": 42}], ["not an object"],
                 [{"question": "one", "reference": "yes"}, {"question": "two"}],
                 [{"question": "one", "reference": " "}]]
        with patch.object(gate, "chat") as chat:
            for items in cases:
                with self.subTest(items=items), self.assertRaises(ValueError):
                    gate.evaluate(items, "candidate", "base", exact=True)
            chat.assert_not_called()

    def test_mode_and_margin_fail_before_inference(self):
        items = [{"question": "one", "reference": "yes"}]
        options = [{}, {"exact": True, "judge": "judge"}, {"exact": True, "margin": -1},
                   {"exact": True, "margin": float("nan")}, {"judge": " "}]
        with patch.object(gate, "chat") as chat:
            for option in options:
                with self.subTest(option=option), self.assertRaises(ValueError):
                    gate.evaluate(items, "candidate", "base", **option)
            chat.assert_not_called()

    def test_exact_evaluation_requires_strict_improvement(self):
        items = [{"question": "one", "reference": "42"}]
        with patch.object(gate, "chat", side_effect=["142", "42"]):
            result = gate.evaluate(items, "candidate", "base", exact=True)
        self.assertEqual((result["candidate_score"], result["base_score"]), (0, 1))
        self.assertFalse(result["ship"])
        with patch.object(gate, "chat", side_effect=["42", "42"]):
            self.assertFalse(gate.evaluate(items, "candidate", "base", exact=True)["ship"])
        with patch.object(gate, "chat", side_effect=["42", "43"]):
            self.assertTrue(gate.evaluate(items, "candidate", "base", exact=True)["ship"])
        with patch.object(gate, "chat", side_effect=["42", "43"]):
            self.assertFalse(gate.evaluate(items, "candidate", "base", exact=True, margin=1)["ship"])

    def test_malformed_judge_or_empty_model_answer_aborts_not_ties(self):
        items = [{"question": "one"}]
        for answers in [["candidate", "base", "no verdict"], ["candidate", "", "TIE"]]:
            with self.subTest(answers=answers), patch.object(gate, "chat", side_effect=answers), self.assertRaises(ValueError):
                gate.evaluate(items, "candidate", "base", judge="judge")

    def test_judge_order_alternates_and_real_ties_do_not_promote(self):
        items = [{"question": "one"}, {"question": "two"}]
        with patch.object(gate, "chat", side_effect=["candidate-one", "base-one", "B", "candidate-two", "base-two", "A"]) as chat:
            result = gate.evaluate(items, "candidate", "base", judge="judge")
            prompts = [call.args[1] for call in chat.call_args_list if call.args[0] == "judge"]
            self.assertIn("Answer A:\nbase-one", prompts[0])
            self.assertIn("Answer A:\ncandidate-two", prompts[1])
            self.assertEqual(result["candidate_score"], 2)
        with patch.object(gate, "chat", side_effect=["candidate", "base", "TIE"]):
            result = gate.evaluate(items[:1], "candidate", "base", judge="judge")
            self.assertEqual(result["ties"], 1)
            self.assertFalse(result["ship"])

    def test_missing_empty_malformed_holdout_returns_no_ship_without_network(self):
        with tempfile.TemporaryDirectory(prefix="prismos-eval-test-") as directory:
            path = Path(directory) / "synthetic.jsonl"
            with patch.object(gate, "chat") as chat:
                for contents in [None, "", " \n ", "{broken}", "[]", '{"question":"one"}']:
                    if contents is not None:
                        path.write_text(contents, encoding="utf-8")
                    with self.subTest(contents=contents), contextlib.redirect_stderr(io.StringIO()) as errors:
                        code = gate.main(["--candidate", "candidate", "--base", "base", "--exact", "--holdout", str(path)])
                    self.assertEqual(code, 2)
                    self.assertIn("NO-SHIP", errors.getvalue())
                chat.assert_not_called()

    def test_main_malformed_judge_never_emits_ship_eligible(self):
        with tempfile.TemporaryDirectory(prefix="prismos-eval-test-") as directory:
            path = Path(directory) / "synthetic.jsonl"
            path.write_text(json.dumps({"question": "synthetic question"}), encoding="utf-8")
            with patch.object(gate, "chat", side_effect=["candidate", "base", "invalid"]), contextlib.redirect_stdout(io.StringIO()) as output, contextlib.redirect_stderr(io.StringIO()) as errors:
                code = gate.main(["--candidate", "candidate", "--base", "base", "--judge", "judge", "--holdout", str(path)])
            self.assertEqual(code, 2)
            self.assertNotIn("SHIP-ELIGIBLE", output.getvalue())
            self.assertIn("NO-SHIP", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
