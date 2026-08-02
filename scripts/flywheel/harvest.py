#!/usr/bin/env python3
"""Disabled personal-feedback harvester.

Positive ratings are preferences, not correctness labels, and PrismOS chat can
contain personal or secret data. The application must not turn that history into
plaintext training JSONL until it ships all of these controls:

* an explicit per-example preview and consent flow;
* secret/PII detection plus manual review;
* a user-selected private output directory outside every Git worktree; and
* an OS-level cross-process training lock.

The product smoke test does not call this file; it creates synthetic examples in
an automatically cleaned temporary directory.
"""

import sys


def main() -> None:
    sys.exit(
        "[harvest] disabled: personal-response export requires dataset preview, "
        "explicit consent, secret/PII review, private output selection, and an "
        "OS-level cross-process lock. Use run_flywheel.sh --smoke for synthetic "
        "toolchain validation."
    )


if __name__ == "__main__":
    main()
