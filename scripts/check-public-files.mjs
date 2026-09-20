#!/usr/bin/env node
// Filename-only release guard. Never reads file contents or changes the index.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAFE_ENV_EXAMPLES = new Set([".env.example", ".env.sample", ".env.template"]);

export function privatePathReason(filename) {
  const normalized = filename.replaceAll("\\", "/");
  const parts = normalized.toLowerCase().split("/");
  const leaf = parts.at(-1) || "";
  if ((leaf === ".env" || leaf.startsWith(".env.")) && !SAFE_ENV_EXAMPLES.has(leaf)) {
    return "environment configuration (only reviewed placeholder examples are public)";
  }
  // One reviewed, public starter pack ships with the app. This is deliberately
  // not a general exception for resources/knowledge or nested/user-added packs.
  const reviewedBundledPack = /^resources\/knowledge\/reliable-local-assistant\/(?:[a-z0-9][a-z0-9_-]*\.md|manifest\.json)$/.test(normalized);
  if (!reviewedBundledPack && parts.some((part) => ["knowledge", "prismdocs", ".claude", "com.prismos.app", "private", "backups"].includes(part))) {
    return "private knowledge, app data, or backup directory";
  }
  if (["claude.md", ".prismos-private-terms", "prismos-handoff.state"].includes(leaf)) {
    return "private configuration or session state";
  }
  if (/\.(?:prismos|prismos-sync|db(?:-journal|-wal|-shm)?|sqlite3?(?:-journal|-wal|-shm)?)$/.test(leaf)) {
    return "knowledge database or private graph export";
  }
  if (/^(?:brain_export|brain_wrapped|spectrum_export|cognitive_profile|conversation|memory_dump).*\.json$/.test(leaf)) {
    return "personal memory export";
  }
  if (/\.(?:gguf|safetensors|npz)$/.test(leaf)
      || parts.some((part) => ["adapters", "fused"].includes(part))
      || /^scripts\/flywheel\/(?:data\/|holdout\.jsonl$)/i.test(normalized)) {
    return "private training data or model weights";
  }
  if (/\.(?:log|pem|key|p12|pfx)$/.test(leaf) || /_evidence.*\.md$/.test(leaf)) {
    return "log, credential material, or private evidence";
  }
  return null;
}

export function gitFilenameArgs(mode) {
  if (mode === "staged") return ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"];
  if (mode === "tracked") return ["ls-files", "--cached", "-z"];
  throw new Error("Use --staged (default) or --tracked.");
}

export function parseGitFilenames(output) {
  if (output !== "" && !output.endsWith("\0")) {
    throw new Error("Git did not return a complete NUL-delimited filename list.");
  }
  return output.split("\0").filter((name) => name !== "");
}

export function inspectFilenames(filenames) {
  return filenames.flatMap((filename) => {
    const reason = privatePathReason(filename);
    return reason ? [{ filename, reason }] : [];
  });
}

export function runGuard(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && !["--staged", "--tracked"].includes(argv[0]))) {
    throw new Error("Use --staged (default) or --tracked.");
  }
  const mode = argv[0] === "--tracked" ? "tracked" : "staged";
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let output;
  try {
    output = execFileSync("git", ["-C", root, ...gitFilenameArgs(mode)], {
      encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Unable to enumerate Git filenames; no release check was completed.");
  }
  const filenames = parseGitFilenames(output);
  const findings = inspectFilenames(filenames);
  if (findings.length) {
    console.error(`Public-file guard blocked ${findings.length} ${mode} path(s):`);
    for (const finding of findings) {
      // JSON quoting keeps embedded newlines/control characters inert in logs.
      console.error(`  ${JSON.stringify(finding.filename)}: ${finding.reason}`);
    }
    console.error("Keep these local and outside public Git. Nothing was unstaged or deleted.");
    return 1;
  }
  console.log(`Public-file filename check passed (${mode}: ${filenames.length} paths).`);
  console.log("This does not scan contents, screenshots, secrets, or Git history. Review those separately.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runGuard();
  } catch (error) {
    console.error(`Public-file guard failed: ${error.message}`);
    process.exitCode = 2;
  }
}
