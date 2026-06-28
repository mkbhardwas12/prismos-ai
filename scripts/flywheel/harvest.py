#!/usr/bin/env python3
"""
harvest.py — Build an MLX-LM fine-tuning dataset from PrismOS validated answers.

Reads the `response_feedback` table in spectrum_graph.db and emits:
  data/train.jsonl, data/valid.jsonl   — SFT pairs (rating > 0), MLX chat format
  data/prefs.jsonl  (optional, --prefs) — (chosen, rejected) per question, for DPO

The verifier/human-rating IS the safety gate: only rating > 0 (thumbs-up / validated)
answers become positive training data. This is what prevents model collapse.

100% local — reads a local SQLite file, writes local JSONL. No network.

Usage:
  python3 harvest.py                       # default DB, 90/10 split into ./data
  python3 harvest.py --min-rating 1 --prefs
  python3 harvest.py --db /path/to/spectrum_graph.db --out ./data
"""
import argparse
import json
import os
import sqlite3
import sys

DEFAULT_DB = os.path.expanduser(
    "~/Library/Application Support/com.prismos.app/spectrum_graph.db"
)


def fetch_rows(db_path):
    if not os.path.exists(db_path):
        sys.exit(f"[harvest] DB not found: {db_path}")
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT question, response, rating, model, created_at "
            "FROM response_feedback ORDER BY created_at"
        ).fetchall()
    except sqlite3.OperationalError as e:
        sys.exit(f"[harvest] cannot read response_feedback: {e}")
    finally:
        con.close()
    return rows


def to_chat(q, a):
    """MLX-LM chat format: one example per line."""
    return {"messages": [
        {"role": "user", "content": q.strip()},
        {"role": "assistant", "content": a.strip()},
    ]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "data"))
    ap.add_argument("--min-rating", type=int, default=1,
                    help="keep answers with rating >= this as positive SFT data")
    ap.add_argument("--valid-frac", type=float, default=0.1)
    ap.add_argument("--min-len", type=int, default=40,
                    help="drop trivially short answers (chars)")
    ap.add_argument("--prefs", action="store_true",
                    help="also emit (chosen, rejected) preference pairs for DPO")
    args = ap.parse_args()

    rows = fetch_rows(args.db)
    ratings = [r["rating"] for r in rows]
    dist = {v: ratings.count(v) for v in sorted(set(ratings))}
    print(f"[harvest] {len(rows)} feedback rows; rating distribution: {dist}")

    positives = [r for r in rows
                 if r["rating"] >= args.min_rating and len(r["response"]) >= args.min_len]
    print(f"[harvest] {len(positives)} positive (validated) examples after filtering")
    if len(positives) < 10:
        print("[harvest] WARNING: very few validated examples. The flywheel needs a "
              "corpus to learn from — keep using the app and rating answers 👍, or lower "
              "--min-len. A 30B LoRA on <50 examples will overfit; aim for hundreds.")

    os.makedirs(args.out, exist_ok=True)
    n_valid = max(1, int(len(positives) * args.valid_frac)) if positives else 0
    valid, train = positives[:n_valid], positives[n_valid:]

    def dump(path, items):
        with open(path, "w") as f:
            for r in items:
                f.write(json.dumps(to_chat(r["question"], r["response"])) + "\n")
        print(f"[harvest] wrote {len(items):4d} -> {path}")

    dump(os.path.join(args.out, "train.jsonl"), train)
    dump(os.path.join(args.out, "valid.jsonl"), valid)

    if args.prefs:
        # Pair a rejected answer with a chosen answer for the SAME question.
        by_q = {}
        for r in rows:
            by_q.setdefault(r["question"].strip(), {}).setdefault(
                "pos" if r["rating"] >= args.min_rating else "neg", []).append(r["response"])
        pairs = []
        for q, d in by_q.items():
            if d.get("pos") and d.get("neg"):
                pairs.append({"prompt": q, "chosen": d["pos"][0], "rejected": d["neg"][0]})
        with open(os.path.join(args.out, "prefs.jsonl"), "w") as f:
            for p in pairs:
                f.write(json.dumps(p) + "\n")
        print(f"[harvest] wrote {len(pairs)} preference pairs -> prefs.jsonl "
              f"(use with mlx-tune DPO once you have enough)")

    if not train:
        sys.exit("[harvest] no training data produced — nothing to fine-tune yet.")
    print("[harvest] done. Next: python3 train_lora.py --smoke   (validate the pipeline)")


if __name__ == "__main__":
    main()
