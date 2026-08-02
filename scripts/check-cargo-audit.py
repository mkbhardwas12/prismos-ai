#!/usr/bin/env python3
"""Fail when Cargo vulnerabilities exist or the reviewed warning set changes."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TAURI = ROOT / "src-tauri"
BASELINE = TAURI / "cargo-audit-baseline.json"


def warning_identity(kind: str, entry: dict) -> tuple[str, str, str, str]:
    advisory = entry.get("advisory") or {}
    package = entry.get("package") or {}
    return (
        str(advisory.get("id") or "missing-advisory-id"),
        str(kind),
        str(package.get("name") or "missing-package"),
        str(package.get("version") or "missing-version"),
    )


def main() -> int:
    try:
        baseline_data = json.loads(BASELINE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"Cargo audit baseline is unreadable: {error}", file=sys.stderr)
        return 2

    required_version = str(baseline_data.get("cargo_audit_version") or "").strip()
    if not required_version:
        print("Cargo audit baseline does not pin cargo_audit_version.", file=sys.stderr)
        return 2
    version_check = subprocess.run(
        ["cargo", "audit", "--version"],
        cwd=TAURI,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if version_check.returncode != 0 or required_version not in version_check.stdout.split():
        actual = version_check.stdout.strip() or version_check.stderr.strip() or "unavailable"
        print(
            f"cargo-audit {required_version} is required by the reviewed baseline; found {actual}.",
            file=sys.stderr,
        )
        return 2

    for entry in baseline_data.get("warnings", []):
        if entry.get("kind") != "unsound":
            continue
        missing = [
            field
            for field in ("owner", "review_by", "rationale")
            if not str(entry.get(field) or "").strip()
        ]
        if missing:
            print(
                f"Unsound advisory {entry.get('id', 'unknown')} lacks reviewed fields: "
                + ", ".join(missing),
                file=sys.stderr,
            )
            return 2
        try:
            review_by = date.fromisoformat(str(entry["review_by"]))
        except ValueError:
            print(
                f"Unsound advisory {entry.get('id', 'unknown')} has an invalid review_by date.",
                file=sys.stderr,
            )
            return 2
        if review_by < date.today():
            print(
                f"Unsound advisory {entry.get('id', 'unknown')} exception expired on {review_by}.",
                file=sys.stderr,
            )
            return 1

    command = ["cargo", "audit", "--file", "Cargo.lock", "--format", "json"]
    if os.environ.get("PRISMOS_CARGO_AUDIT_NO_FETCH") == "1":
        command.append("--no-fetch")
    completed = subprocess.run(
        command,
        cwd=TAURI,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    try:
        report = json.loads(completed.stdout)
    except json.JSONDecodeError:
        print("cargo-audit did not return a valid JSON report.", file=sys.stderr)
        if completed.stderr:
            print(completed.stderr.strip(), file=sys.stderr)
        return 2

    vulnerabilities = report.get("vulnerabilities") or {}
    vulnerability_list = vulnerabilities.get("list") or []
    if vulnerabilities.get("found") or int(vulnerabilities.get("count") or 0) > 0:
        print("Cargo audit found release-blocking vulnerabilities:", file=sys.stderr)
        for entry in vulnerability_list:
            advisory = entry.get("advisory") or {}
            package = entry.get("package") or {}
            print(
                f"- {advisory.get('id', 'unknown')}: "
                f"{package.get('name', 'unknown')} {package.get('version', 'unknown')}",
                file=sys.stderr,
            )
        return 1

    expected = {
        (
            str(entry["id"]),
            str(entry["kind"]),
            str(entry["package"]),
            str(entry["version"]),
        )
        for entry in baseline_data.get("warnings", [])
    }
    current = {
        warning_identity(kind, entry)
        for kind, entries in (report.get("warnings") or {}).items()
        for entry in entries
    }

    added = sorted(current - expected)
    removed = sorted(expected - current)
    if added or removed:
        print("Cargo audit warning baseline changed; explicit review is required.", file=sys.stderr)
        for advisory_id, kind, package, version in added:
            print(f"+ {advisory_id} {kind} {package} {version}", file=sys.stderr)
        for advisory_id, kind, package, version in removed:
            print(f"- {advisory_id} {kind} {package} {version}", file=sys.stderr)
        return 1

    if completed.returncode != 0:
        print("cargo-audit exited unsuccessfully despite a parseable clean report.", file=sys.stderr)
        return 2

    print(
        f"Cargo audit passed: 0 known vulnerabilities; "
        f"{len(current)} reviewed informational warnings unchanged."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
