#!/usr/bin/env python3
"""
eval_gate.py — Holdout-eval SHIP/NO-SHIP gate for a freshly fine-tuned model.

The flywheel's safety valve: a new model version may ONLY ship if it does not
regress against the current base on a held-out question set. This is what stops
a bad self-training round from degrading your daily driver (model collapse guard).

Two scoring modes:
  --judge <model>   : LLM-as-judge — a strong local model blind-compares the two
                      answers per question and picks the better one (default).
  --exact data.jsonl: for verifiable tasks, score by exact/normalized match to a
                      'reference' field (use this for code/math/SAP where you have
                      ground truth — far more trustworthy than self-judging).

Everything runs against local Ollama (localhost:11434). No egress.

Usage:
  python3 eval_gate.py --candidate qwen3-prism:v20260628 --base qwen3:30b-a3b \\
      --holdout holdout.jsonl --judge qwen3:32b
  # holdout.jsonl lines: {"question": "...", "reference": "...optional..."}
"""
import argparse
import json
import sys
import urllib.request

OLLAMA = "http://localhost:11434/api/chat"


def chat(model, content, system=None):
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": content})
    body = json.dumps({"model": model, "messages": msgs, "stream": False,
                       "keep_alive": "10m"}).encode()
    req = urllib.request.Request(OLLAMA, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:  # localhost only
        return json.loads(r.read())["message"]["content"].strip()


def load(path):
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]


JUDGE_SYS = (
    "You are an impartial evaluator. You will see a QUESTION and two anonymized "
    "answers, A and B. Reply with EXACTLY one token: 'A', 'B', or 'TIE' — whichever "
    "answers the question better (accuracy, completeness, usefulness). No other text."
)


def judge_pick(judge_model, q, ans_a, ans_b):
    out = chat(judge_model,
               f"QUESTION:\n{q}\n\nAnswer A:\n{ans_a}\n\nAnswer B:\n{ans_b}\n\n"
               "Which is better? Reply A, B, or TIE. /no_think",
               system=JUDGE_SYS).upper()
    if out.startswith("A"):
        return "A"
    if out.startswith("B"):
        return "B"
    return "TIE"


def normalize(s):
    return " ".join(s.lower().split())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidate", required=True, help="newly trained Ollama model:tag")
    ap.add_argument("--base", required=True, help="current default model to beat")
    ap.add_argument("--holdout", required=True, help="jsonl of {question[, reference]}")
    ap.add_argument("--judge", default=None, help="LLM-judge model (omit to use --exact)")
    ap.add_argument("--exact", action="store_true",
                    help="score by exact/normalized match to 'reference' (verifiable tasks)")
    ap.add_argument("--margin", type=float, default=0.0,
                    help="candidate must beat base by > this fraction to SHIP")
    args = ap.parse_args()

    items = load(args.holdout)
    if not items:
        sys.exit("[eval] empty holdout set.")
    print(f"[eval] {len(items)} holdout items · candidate={args.candidate} base={args.base}")

    cand_score = base_score = ties = 0
    for i, it in enumerate(items, 1):
        q = it["question"]
        a_cand = chat(args.candidate, q)
        a_base = chat(args.base, q)

        if args.exact:
            ref = normalize(it.get("reference", ""))
            c_ok = ref and ref in normalize(a_cand)
            b_ok = ref and ref in normalize(a_base)
            cand_score += int(c_ok)
            base_score += int(b_ok)
            verdict = f"cand={'✓' if c_ok else '✗'} base={'✓' if b_ok else '✗'}"
        else:
            if not args.judge:
                sys.exit("[eval] provide --judge MODEL (or --exact with references).")
            # Anonymize + swap order across items to cancel position bias.
            if i % 2 == 0:
                pick = judge_pick(args.judge, q, a_cand, a_base)
                win = "cand" if pick == "A" else "base" if pick == "B" else "tie"
            else:
                pick = judge_pick(args.judge, q, a_base, a_cand)
                win = "base" if pick == "A" else "cand" if pick == "B" else "tie"
            cand_score += int(win == "cand")
            base_score += int(win == "base")
            ties += int(win == "tie")
            verdict = f"winner={win}"
        print(f"  [{i:3d}/{len(items)}] {verdict}  | {q[:60]}")

    n = len(items)
    cand_frac, base_frac = cand_score / n, base_score / n
    print(f"\n[eval] candidate {cand_score}/{n} ({cand_frac:.0%})  "
          f"base {base_score}/{n} ({base_frac:.0%})  ties {ties}")
    ship = cand_frac > base_frac + args.margin
    print(f"[eval] DECISION: {'✅ SHIP — set as default + keep N-1 for rollback' if ship else '🛑 NO-SHIP — discard this version, keep current base'}")
    sys.exit(0 if ship else 1)


if __name__ == "__main__":
    main()
