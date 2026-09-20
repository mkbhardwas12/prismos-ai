//! Explicit local knowledge-pack importer; dry-run is the default.

use prismos_lib::knowledge_import::{import_pack, ImportMode};
use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "Usage: prismos-knowledge --app-dir EXISTING_DIR --pack-dir EXISTING_DIR [--dry-run | --apply]\n\
Dry-run is the default and never opens the database. --apply imports manifest-reviewed Markdown locally.\n\
No network or model calls are made. Output contains source identities and counts, never document text.";

#[derive(Debug)]
struct Args {
    app_dir: PathBuf,
    pack_dir: PathBuf,
    mode: ImportMode,
}

fn parse_args(values: impl IntoIterator<Item = String>) -> Result<Option<Args>, String> {
    let mut values = values.into_iter();
    let mut app_dir = None;
    let mut pack_dir = None;
    let mut selected_mode = None;
    while let Some(value) = values.next() {
        match value.as_str() {
            "--help" | "-h" => return Ok(None),
            "--app-dir" | "--pack-dir" => {
                let path = values
                    .next()
                    .filter(|path| !path.is_empty() && !path.starts_with("--"))
                    .ok_or_else(|| format!("{value} requires an explicit directory"))?;
                let slot = if value == "--app-dir" {
                    &mut app_dir
                } else {
                    &mut pack_dir
                };
                if slot.replace(PathBuf::from(path)).is_some() {
                    return Err(format!("{value} may only be provided once"));
                }
            }
            "--apply" | "--dry-run" => {
                if selected_mode.is_some() {
                    return Err("Choose exactly one of --apply or --dry-run".into());
                }
                selected_mode = Some(if value == "--apply" {
                    ImportMode::Apply
                } else {
                    ImportMode::DryRun
                });
            }
            _ => return Err(format!("Unknown argument: {value}")),
        }
    }
    Ok(Some(Args {
        app_dir: app_dir.ok_or("--app-dir is required")?,
        pack_dir: pack_dir.ok_or("--pack-dir is required")?,
        mode: selected_mode.unwrap_or(ImportMode::DryRun),
    }))
}

fn main() -> ExitCode {
    let args = match parse_args(std::env::args().skip(1)) {
        Ok(Some(args)) => args,
        Ok(None) => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Err(error) => {
            eprintln!("{error}\n{USAGE}");
            return ExitCode::FAILURE;
        }
    };
    match import_pack(&args.app_dir, &args.pack_dir, args.mode) {
        Ok(report) => match serde_json::to_string_pretty(&report) {
            Ok(json) => {
                println!("{json}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("Cannot encode import report: {error}");
                ExitCode::FAILURE
            }
        },
        Err(error) => {
            eprintln!("Knowledge import failed: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_directories_are_required_and_dry_run_is_default() {
        assert!(parse_args(Vec::<String>::new()).is_err());
        let args = parse_args(
            ["--app-dir", "/fixtures/app", "--pack-dir", "/fixtures/pack"].map(String::from),
        )
        .unwrap()
        .unwrap();
        assert_eq!(args.mode, ImportMode::DryRun);
        assert!(parse_args(["--app-dir", "--apply"].map(String::from)).is_err());
    }

    #[test]
    fn apply_must_be_unambiguous() {
        let args = parse_args(
            [
                "--app-dir",
                "/fixtures/app",
                "--pack-dir",
                "/fixtures/pack",
                "--apply",
            ]
            .map(String::from),
        )
        .unwrap()
        .unwrap();
        assert_eq!(args.mode, ImportMode::Apply);
        assert!(parse_args(["--apply", "--dry-run"].map(String::from)).is_err());
    }
}
