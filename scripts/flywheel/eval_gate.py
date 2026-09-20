#!/usr/bin/env python3
"""
eval_gate.py — Holdout-eval SHIP/NO-SHIP gate for a freshly fine-tuned model.

An experimental comparison on a held-out question set, not a guarantee of
factual accuracy or protection against model collapse. It never promotes a
model or changes the app's default; a passing result still needs human review.

Two scoring modes:
  --judge <model>   : LLM-as-judge — a strong local model blind-compares the two
                      answers per question and picks the better one.
  --exact          : score by normalized equality to a non-empty 'reference'.
                      Suitable only for short answers with reviewed answer keys,
                      not verification of executable code or SAP procedures.

Everything runs against local Ollama (localhost:11434). No egress.

Usage:
  python3 eval_gate.py --candidate qwen3-prism:v20260628 --base qwen3:30b-a3b \\
      --holdout holdout.jsonl --judge qwen3:32b
  # holdout.jsonl lines: {"question": "...", "reference": "...optional..."}
"""
import argparse
import json
import math
import sys
import urllib.request

OLLAMA = "http://127.0.0.1:11434/api/chat"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("local evaluation endpoint redirects are not allowed")


# Personal holdout answers must not follow redirects or environment proxies.
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def chat(model, content, system=None):
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": content})
    body = json.dumps({"model": model, "messages": msgs, "stream": False,
                       "keep_alive": "10m"}).encode()
    req = urllib.request.Request(OLLAMA, data=body,
                                 headers={"Content-Type": "application/json"})
    with _OPENER.open(req, timeout=600) as r:  # fixed loopback, no proxies/redirects
        payload = json.loads(r.read())
    if not isinstance(payload, dict) or payload.get("done") is not True:
        raise ValueError("model completion is missing its completion marker")
    if payload.get("done_reason") == "length":
        raise ValueError("model completion was truncated; evaluation is incomplete")
    message = payload.get("message")
    if not isinstance(message, dict):
        raise ValueError("model completion is missing its message")
    return require_answer(message.get("content"))


def validate_items(items, exact=False):
    """Validate the entire test set before any model request is made."""
    if not isinstance(items, list) or not items:
        raise ValueError("holdout must contain at least one test item")
    for number, item in enumerate(items, 1):
        if not isinstance(item, dict):
            raise ValueError(f"holdout item {number} must be an object")
        question = item.get("question")
        if not isinstance(question, str) or not question.strip():
            raise ValueError(f"holdout item {number} requires a non-empty question")
        reference = item.get("reference")
        if exact and (not isinstance(reference, str) or not normalize(reference)):
            raise ValueError(f"holdout item {number} requires a non-empty reference for --exact")
    return items


def load(path, exact=False):
    items = []
    with open(path, encoding="utf-8") as f:
        for number, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError as error:
                # Do not echo potentially private corpus contents into logs.
                raise ValueError(f"invalid holdout JSON on line {number}") from error
    return validate_items(items, exact)


JUDGE_SYS = (
    "You are an impartial evaluator. You will see a QUESTION and two anonymized "
    "answers, A and B. Reply with EXACTLY one token: 'A', 'B', or 'TIE' — whichever "
    "answers the question better (accuracy, completeness, usefulness). No other text."
)


def judge_pick(judge_model, q, ans_a, ans_b):
    out = chat(judge_model,
               f"QUESTION:\n{q}\n\nAnswer A:\n{ans_a}\n\nAnswer B:\n{ans_b}\n\n"
               "Which is better? Reply A, B, or TIE. /no_think",
               system=JUDGE_SYS)
    return parse_judge(out)


def parse_judge(output):
    """Only an explicit complete verdict counts; malformed output is not a tie."""
    verdict = require_answer(output).upper()
    if verdict not in {"A", "B", "TIE"}:
        raise ValueError("judge returned an invalid verdict; expected exactly A, B, or TIE")
    return verdict


def normalize(s):
    if not isinstance(s, str):
        raise ValueError("answer/reference must be text")
    return " ".join(s.lower().split())


def require_answer(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("model returned a missing or empty answer")
    return value.strip()


def exact_match(answer, reference):
    ref = normalize(reference)
    if not ref:
        raise ValueError("exact comparison requires a non-empty reference")
    return normalize(answer) == ref


def promotion_margin(value):
    margin = float(value)
    if not math.isfinite(margin) or margin < 0:
        raise ValueError("promotion margin must be a nonnegative finite number")
    return margin


def evaluate(items, candidate, base, *, exact=False, judge=None, margin=0.0, progress=None):
    margin = promotion_margin(margin)
    if exact == bool(judge):
        raise ValueError("choose exactly one scoring mode: --exact or --judge MODEL")
    if not isinstance(candidate, str) or not candidate.strip() or not isinstance(base, str) or not base.strip():
        raise ValueError("candidate and base model names must be non-empty")
    if judge is not None and (not isinstance(judge, str) or not judge.strip()):
        raise ValueError("judge model name must be non-empty")
    validate_items(items, exact)
    cand_score = base_score = ties = 0
    for i, item in enumerate(items, 1):
        question = item["question"]
        a_cand = require_answer(chat(candidate, question))
        a_base = require_answer(chat(base, question))
        if exact:
            c_ok = exact_match(a_cand, item["reference"])
            b_ok = exact_match(a_base, item["reference"])
            cand_score += int(c_ok)
            base_score += int(b_ok)
            verdict = f"cand={'✓' if c_ok else '✗'} base={'✓' if b_ok else '✗'}"
        else:
            # Alternate order to reduce (not eliminate) judge position bias.
            if i % 2 == 0:
                pick = judge_pick(judge, question, a_cand, a_base)
                win = "cand" if pick == "A" else "base" if pick == "B" else "tie"
            else:
                pick = judge_pick(judge, question, a_base, a_cand)
                win = "base" if pick == "A" else "cand" if pick == "B" else "tie"
            cand_score += int(win == "cand")
            base_score += int(win == "base")
            ties += int(win == "tie")
            verdict = f"winner={win}"
        if progress:
            progress(i, len(items), verdict)
    total = len(items)
    return {"candidate_score": cand_score, "base_score": base_score, "ties": ties,
            "total": total, "ship": cand_score / total > base_score / total + margin}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidate", required=True, help="newly trained Ollama model:tag")
    ap.add_argument("--base", required=True, help="current default model to beat")
    ap.add_argument("--holdout", required=True, help="jsonl of {question[, reference]}")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--judge", default=None, help="LLM-judge model (not a factual verifier)")
    mode.add_argument("--exact", action="store_true",
                    help="score by exact/normalized match to 'reference' (verifiable tasks)")
    ap.add_argument("--margin", type=float, default=0.0,
                    help="candidate must beat base by > this fraction to SHIP")
    args = ap.parse_args(argv)
    try:
        margin = promotion_margin(args.margin)
        items = load(args.holdout, args.exact)
        print(f"[eval] {len(items)} holdout items · candidate={args.candidate} base={args.base}")
        result = evaluate(items, args.candidate, args.base, exact=args.exact,
                          judge=args.judge, margin=margin,
                          progress=lambda i, n, verdict: print(f"  [{i:3d}/{n}] {verdict}"))
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"[eval] NO-SHIP: incomplete or invalid evaluation: {error}", file=sys.stderr)
        return 2

    n = result["total"]
    cand_score, base_score, ties = result["candidate_score"], result["base_score"], result["ties"]
    cand_frac, base_frac = cand_score / n, base_score / n
    print(f"\n[eval] candidate {cand_score}/{n} ({cand_frac:.0%})  "
          f"base {base_score}/{n} ({base_frac:.0%})  ties {ties}")
    ship = result["ship"]
    print(f"[eval] DECISION: {'SHIP-ELIGIBLE — comparison passed; manual review still required' if ship else 'NO-SHIP — comparison did not clear the margin'}")
    print("[eval] No model promoted. This comparison does not establish general correctness or safety.")
    return 0 if ship else 1


if __name__ == "__main__":
    sys.exit(main())
