import assert from "node:assert/strict";
import test from "node:test";
import { gitFilenameArgs, inspectFilenames, parseGitFilenames, privatePathReason } from "./check-public-files.mjs";

test("blocks real export formats, databases, environment variants and private directories", () => {
  for (const filename of [
    "prismos-graph-2026-09-08.prismos", "prismos-sync-2026-09-08.prismos-sync",
    "prismos-handoff.state", "copy/PRISMOS-HANDOFF.STATE", "spectrum_graph.db",
    "snapshot.sqlite3-wal", "nested/snapshot.sqlite-shm", ".env", ".env.production",
    "config/.env.staging", "knowledge/notes.md", "PrismDocs/brief.md",
    ".claude/settings.json", "CLAUDE.md", "copy/com.prismos.app/settings.json",
    "private/note.md", "backups/recovery.zip", "conversation-export.json",
    "scripts/flywheel/data/train.jsonl", "scripts/flywheel/holdout.jsonl",
    "scripts/flywheel/adapters/config.json", "trained.gguf", "key.pem",
    "debug.log", "case_EVIDENCE.md", "nested\\knowledge\\note.md",
  ]) {
    assert.ok(privatePathReason(filename), filename);
  }
});

test("allows source code, documentation and explicitly named environment examples", () => {
  for (const filename of [
    "src/lib/knowledgeGraph.ts", "src-tauri/src/you_port.rs", "docs/ARCHITECTURE.md",
    "scripts/check-public-files.mjs", "scripts/flywheel/README.md", "package-lock.json",
    ".env.example", "config/.env.sample", ".env.template", "src/test/SettingsPanel.test.tsx",
  ]) {
    assert.equal(privatePathReason(filename), null, filename);
  }
});

test("permits only direct safe filenames in the reviewed public knowledge pack", () => {
  const prefix = "resources/knowledge/reliable-local-assistant/";
  for (const filename of ["manifest.json", "reasoning.md", "artifact-quality.md", "model-capabilities.md"]) {
    assert.equal(privatePathReason(prefix + filename), null, filename);
  }
  for (const filename of [
    "knowledge/reasoning.md", "resources/knowledge/personal/reasoning.md",
    "resources/knowledge/reliable-local-assistant-copy/reasoning.md",
    "Resources/knowledge/reliable-local-assistant/reasoning.md",
    prefix + "nested/reasoning.md", prefix + "../private.md",
    prefix + "notes.json", prefix + "manifest.JSON", prefix + "Private.md",
    prefix + ".hidden.md", prefix + "with spaces.md", prefix + "backup.prismos",
    prefix + "CLAUDE.md", prefix + ".env.production",
  ]) {
    assert.ok(privatePathReason(filename), filename);
  }
});

test("enumerates only Git filenames and keeps removals out of staged checks", () => {
  assert.deepEqual(gitFilenameArgs("staged"), ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]);
  assert.deepEqual(gitFilenameArgs("tracked"), ["ls-files", "--cached", "-z"]);
  assert.throws(() => gitFilenameArgs("unknown"));
});

test("NUL parsing preserves spaces/newlines and fails closed on incomplete output", () => {
  assert.deepEqual(parseGitFilenames("source file.ts\0private/line\nbreak.md\0"), ["source file.ts", "private/line\nbreak.md"]);
  assert.deepEqual(parseGitFilenames(""), []);
  assert.throws(() => parseGitFilenames("partial"));
  const findings = inspectFilenames(["src/app.ts", "knowledge/a.md", "snapshot.prismos"]);
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((finding) => finding.filename), ["knowledge/a.md", "snapshot.prismos"]);
});
