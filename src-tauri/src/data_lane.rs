//! Data lane — deterministic, offline analysis of tabular attachments.
//!
//! The chat model is bad at arithmetic over thousands of rows and good at
//! explaining a summary. So this module does the counting: it parses a CSV / TSV
//! (or the tab-joined text our XLSX extractor emits), profiles every column, and
//! aggregates a series for a chart. The model only ever sees the profile — never
//! the raw rows — and the chart is rendered from numbers computed here.
//!
//! Everything is bounded (rows, cells, columns) so a hostile or huge file cannot
//! stall the UI, and everything is pure so it is fully unit-tested.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const MAX_ROWS: usize = 200_000;
pub const MAX_COLUMNS: usize = 256;
pub const MAX_CELL_CHARS: usize = 2_000;
pub const SAMPLE_ROWS: usize = 5;
pub const TOP_VALUES: usize = 5;
pub const MAX_SERIES_POINTS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Table {
    pub name: String,
    pub sheet: Option<String>,
    pub delimiter: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    /// True when MAX_ROWS was hit and the tail was ignored.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NumericStats {
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub median: f64,
    pub sum: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColumnProfile {
    pub name: String,
    /// number | date | bool | text | empty
    pub kind: String,
    pub non_empty: usize,
    pub unique: usize,
    pub numeric: Option<NumericStats>,
    pub top_values: Vec<(String, usize)>,
    pub example: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TableProfile {
    pub name: String,
    pub sheet: Option<String>,
    pub row_count: usize,
    pub column_count: usize,
    pub truncated: bool,
    pub columns: Vec<ColumnProfile>,
    pub sample: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AggregateSpec {
    /// Column to group by.
    pub x: String,
    /// Numeric column to aggregate; None only with agg = "count".
    pub y: Option<String>,
    /// sum | avg | count | min | max
    pub agg: String,
    /// Keep the top-N groups by value (bar/pie); 0 = keep all (line).
    #[serde(default)]
    pub limit: usize,
    /// Sort groups by their label (dates / numbers) instead of by value.
    #[serde(default)]
    pub sort_by_label: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Series {
    pub x_label: String,
    pub y_label: String,
    pub points: Vec<(String, f64)>,
    pub groups_total: usize,
    /// Rows whose y value was not numeric and were ignored.
    pub skipped_rows: usize,
}

// ─── Parsing ─────────────────────────────────────────────────────────────

fn strip_attachment_header(text: &str) -> &str {
    // "[File: name]\n…" or "[Document: … ]\n\n…" headers added by the extractors.
    if text.starts_with("[File:") || text.starts_with("[Document:") {
        if let Some(i) = text.find('\n') {
            return text[i + 1..].trim_start_matches('\n');
        }
    }
    text
}

/// Choose the delimiter that yields the most consistent column count.
pub fn sniff_delimiter(text: &str) -> char {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).take(20).collect();
    let mut best = (',', 0usize, usize::MAX);
    for cand in [',', '\t', ';', '|'] {
        let counts: Vec<usize> = lines.iter().map(|l| split_record(l, cand).len()).collect();
        if counts.is_empty() {
            continue;
        }
        let first = counts[0];
        if first < 2 {
            continue;
        }
        let consistent = counts.iter().filter(|&&c| c == first).count();
        let variance = counts.iter().filter(|&&c| c != first).count();
        if consistent > best.1 || (consistent == best.1 && variance < best.2) {
            best = (cand, consistent, variance);
        }
    }
    best.0
}

/// Split one physical record; quotes handled per RFC 4180 (doubled quote = literal).
fn split_record(line: &str, delim: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    cur.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(c);
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == delim {
            out.push(std::mem::take(&mut cur));
        } else if c != '\r' {
            cur.push(c);
        }
    }
    out.push(cur);
    out
}

/// Join physical lines into logical records (a quoted field may span lines).
fn logical_records(text: &str) -> Vec<String> {
    let mut records = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    for line in text.split('\n') {
        if !cur.is_empty() {
            cur.push('\n');
        }
        cur.push_str(line);
        in_quotes ^= line.matches('"').count() % 2 == 1;
        if !in_quotes {
            let rec = std::mem::take(&mut cur);
            if !rec.trim().is_empty() {
                records.push(rec);
            }
        }
    }
    if !cur.trim().is_empty() {
        records.push(cur);
    }
    records
}

fn clean_cell(s: String) -> String {
    let t = s.trim();
    if t.chars().count() > MAX_CELL_CHARS {
        t.chars().take(MAX_CELL_CHARS).collect()
    } else {
        t.to_string()
    }
}

/// Parse attachment text into a table. XLSX text (`── Sheet: … ──` blocks) uses
/// its first non-empty sheet; anything else is delimiter-sniffed CSV/TSV.
pub fn parse_table(text: &str, name: &str) -> Result<Table, String> {
    let body = strip_attachment_header(text);
    let (body, sheet, forced_delim): (String, Option<String>, Option<char>) = if body.contains("── Sheet:") {
        let mut chosen: Option<(String, String)> = None;
        let mut current: Option<(String, String)> = None;
        for line in body.lines() {
            if let Some(rest) = line.strip_prefix("── Sheet: ") {
                if let Some((n, b)) = current.take() {
                    if b.lines().filter(|l| !l.trim().is_empty()).count() >= 2 {
                        chosen = Some((n, b));
                        break;
                    }
                }
                current = Some((rest.trim_end_matches(" ──").trim().to_string(), String::new()));
            } else if let Some((_, b)) = current.as_mut() {
                b.push_str(line);
                b.push('\n');
            }
        }
        if chosen.is_none() {
            if let Some((n, b)) = current {
                chosen = Some((n, b));
            }
        }
        let (n, b) = chosen.ok_or_else(|| "Spreadsheet has no sheet with data".to_string())?;
        (b, Some(n), Some('\t'))
    } else {
        (body.to_string(), None, None)
    };

    let delim = forced_delim.unwrap_or_else(|| sniff_delimiter(&body));
    let records = logical_records(&body);
    if records.len() < 2 {
        return Err("Not a table: need a header row and at least one data row".to_string());
    }
    let header: Vec<String> = split_record(&records[0], delim).into_iter().map(clean_cell).collect();
    if header.len() < 2 && delim != '\t' {
        return Err("Not a table: only one column detected".to_string());
    }
    if header.len() > MAX_COLUMNS {
        return Err(format!("Too many columns ({} > {MAX_COLUMNS})", header.len()));
    }
    // Make header names unique and non-empty so they can be referenced.
    let mut seen: HashMap<String, usize> = HashMap::new();
    let columns: Vec<String> = header
        .into_iter()
        .enumerate()
        .map(|(i, h)| {
            let base = if h.is_empty() { format!("column_{}", i + 1) } else { h };
            let n = seen.entry(base.clone()).or_insert(0);
            *n += 1;
            if *n == 1 { base } else { format!("{base}_{n}") }
        })
        .collect();
    let width = columns.len();
    let mut rows = Vec::new();
    let mut truncated = false;
    for rec in records.iter().skip(1) {
        if rows.len() >= MAX_ROWS {
            truncated = true;
            break;
        }
        let mut cells: Vec<String> = split_record(rec, delim).into_iter().map(clean_cell).collect();
        if cells.iter().all(|c| c.is_empty()) {
            continue;
        }
        cells.resize(width, String::new());
        rows.push(cells);
    }
    if rows.is_empty() {
        return Err("Not a table: no data rows".to_string());
    }
    Ok(Table { name: name.to_string(), sheet, delimiter: delim.to_string(), columns, rows, truncated })
}

// ─── Typing & profiling ──────────────────────────────────────────────────

pub fn parse_number(s: &str) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    let (neg, t) = if t.starts_with('(') && t.ends_with(')') { (true, &t[1..t.len() - 1]) } else { (false, t) };
    let cleaned: String = t
        .chars()
        .filter(|c| !matches!(c, ',' | '$' | '€' | '£' | '%' | ' ' | '\u{a0}'))
        .collect();
    let v: f64 = cleaned.parse().ok()?;
    if !v.is_finite() {
        return None;
    }
    Some(if neg { -v } else { v })
}

fn looks_like_date(s: &str) -> bool {
    let t = s.trim();
    let digits = t.chars().filter(|c| c.is_ascii_digit()).count();
    if digits < 4 || t.len() > 40 {
        return false;
    }
    // 2026-09-27, 27/09/2026, 09-27-26, 2026-09-27T10:00:00Z, Sep 2026, 27 Sep 2026
    let iso = t.len() >= 8 && t[..4].chars().all(|c| c.is_ascii_digit()) && matches!(t.chars().nth(4), Some('-') | Some('/'));
    let slashed = t.matches('/').count() == 2 || t.matches('-').count() == 2;
    let month_word = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        .iter()
        .any(|m| t.to_ascii_lowercase().contains(m));
    iso || (slashed && digits >= 6) || (month_word && digits >= 4)
}

fn is_bool(s: &str) -> bool {
    matches!(s.trim().to_ascii_lowercase().as_str(), "true" | "false" | "yes" | "no" | "y" | "n")
}

fn median(sorted: &[f64]) -> f64 {
    let n = sorted.len();
    if n == 0 {
        return 0.0;
    }
    if n % 2 == 1 { sorted[n / 2] } else { (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0 }
}

pub fn profile_column(name: &str, values: &[&str]) -> ColumnProfile {
    let non_empty: Vec<&str> = values.iter().copied().filter(|v| !v.trim().is_empty()).collect();
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for v in &non_empty {
        *counts.entry(*v).or_insert(0) += 1;
    }
    let unique = counts.len();
    let n = non_empty.len();
    let numbers: Vec<f64> = non_empty.iter().filter_map(|v| parse_number(v)).collect();
    let dates = non_empty.iter().filter(|v| looks_like_date(v)).count();
    let bools = non_empty.iter().filter(|v| is_bool(v)).count();
    let kind = if n == 0 {
        "empty"
    } else if numbers.len() * 10 >= n * 9 {
        "number"
    } else if dates * 10 >= n * 9 {
        "date"
    } else if bools == n {
        "bool"
    } else {
        "text"
    };
    let numeric = if kind == "number" && !numbers.is_empty() {
        let mut sorted = numbers.clone();
        sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let sum: f64 = sorted.iter().sum();
        Some(NumericStats { min: sorted[0], max: sorted[sorted.len() - 1], mean: sum / sorted.len() as f64, median: median(&sorted), sum })
    } else {
        None
    };
    let mut top: Vec<(String, usize)> = counts.into_iter().map(|(v, c)| (v.to_string(), c)).collect();
    top.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    top.truncate(TOP_VALUES);
    ColumnProfile {
        name: name.to_string(),
        kind: kind.to_string(),
        non_empty: n,
        unique,
        numeric,
        top_values: if kind == "number" { vec![] } else { top },
        example: non_empty.first().map(|s| s.chars().take(80).collect()).unwrap_or_default(),
    }
}

pub fn profile_table(table: &Table) -> TableProfile {
    let columns = table
        .columns
        .iter()
        .enumerate()
        .map(|(i, name)| {
            let values: Vec<&str> = table.rows.iter().map(|r| r.get(i).map(|s| s.as_str()).unwrap_or("")).collect();
            profile_column(name, &values)
        })
        .collect();
    TableProfile {
        name: table.name.clone(),
        sheet: table.sheet.clone(),
        row_count: table.rows.len(),
        column_count: table.columns.len(),
        truncated: table.truncated,
        columns,
        sample: table.rows.iter().take(SAMPLE_ROWS).cloned().collect(),
    }
}

// ─── Aggregation ─────────────────────────────────────────────────────────

pub fn aggregate(table: &Table, spec: &AggregateSpec) -> Result<Series, String> {
    let xi = table.columns.iter().position(|c| c == &spec.x).ok_or_else(|| format!("Unknown column '{}'", spec.x))?;
    let agg = spec.agg.to_ascii_lowercase();
    if !matches!(agg.as_str(), "sum" | "avg" | "count" | "min" | "max") {
        return Err(format!("Unknown aggregation '{}'", spec.agg));
    }
    let yi = match (&spec.y, agg.as_str()) {
        (Some(y), _) => Some(table.columns.iter().position(|c| c == y).ok_or_else(|| format!("Unknown column '{y}'"))?),
        (None, "count") => None,
        (None, _) => return Err(format!("Aggregation '{agg}' needs a numeric column")),
    };
    let mut groups: Vec<(String, Vec<f64>)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut skipped = 0usize;
    for row in &table.rows {
        let key = row.get(xi).cloned().unwrap_or_default();
        let key = if key.is_empty() { "(blank)".to_string() } else { key };
        let value = match yi {
            None => Some(1.0),
            Some(i) => parse_number(row.get(i).map(|s| s.as_str()).unwrap_or("")),
        };
        let Some(v) = value else { skipped += 1; continue; };
        let gi = *index.entry(key.clone()).or_insert_with(|| { groups.push((key, Vec::new())); groups.len() - 1 });
        groups[gi].1.push(v);
    }
    let groups_total = groups.len();
    let mut points: Vec<(String, f64)> = groups
        .into_iter()
        .map(|(k, vs)| {
            let v = match agg.as_str() {
                "sum" | "count" => vs.iter().sum(),
                "avg" => vs.iter().sum::<f64>() / vs.len() as f64,
                "min" => vs.iter().cloned().fold(f64::INFINITY, f64::min),
                _ => vs.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
            };
            (k, v)
        })
        .collect();
    if spec.sort_by_label {
        points.sort_by(|a, b| match (parse_number(&a.0), parse_number(&b.0)) {
            (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal),
            _ => a.0.cmp(&b.0),
        });
    } else {
        points.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.0.cmp(&b.0)));
    }
    let limit = if spec.limit == 0 { MAX_SERIES_POINTS } else { spec.limit.min(MAX_SERIES_POINTS) };
    if points.len() > limit {
        let rest: Vec<(String, f64)> = points.split_off(limit);
        if !spec.sort_by_label && matches!(agg.as_str(), "sum" | "count") {
            let other: f64 = rest.iter().map(|p| p.1).sum();
            points.push((format!("Other ({} more)", rest.len()), other));
        }
    }
    let y_label = match (&spec.y, agg.as_str()) {
        (None, _) => "count".to_string(),
        (Some(y), a) => format!("{a}({y})"),
    };
    Ok(Series { x_label: spec.x.clone(), y_label, points, groups_total, skipped_rows: skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSV: &str = "[File: sales.csv]\nregion,amount,date,\"note, quoted\"\nEMEA,\"1,200\",2026-01-05,\"said \"\"hi\"\"\"\nAPAC,800.5,2026-01-06,\"multi\nline\"\nEMEA,300,2026-02-01,\nAMER,(50),2026-02-02,x\n";

    #[test]
    fn parses_quotes_embedded_newlines_and_thousands_separators() {
        let t = parse_table(CSV, "sales.csv").unwrap();
        assert_eq!(t.columns, vec!["region", "amount", "date", "note, quoted"]);
        assert_eq!(t.rows.len(), 4);
        assert_eq!(t.rows[0][3], "said \"hi\"");
        assert_eq!(t.rows[1][3], "multi\nline");
        assert_eq!(parse_number(&t.rows[0][1]), Some(1200.0));
        assert_eq!(parse_number(&t.rows[3][1]), Some(-50.0));
        assert_eq!(t.delimiter, ",");
        assert!(t.sheet.is_none());
    }

    #[test]
    fn sniffs_semicolon_and_tab_and_pipe() {
        assert_eq!(sniff_delimiter("a;b;c\n1;2;3\n"), ';');
        assert_eq!(sniff_delimiter("a\tb\n1\t2\n"), '\t');
        assert_eq!(sniff_delimiter("a|b|c\n1|2|3\n"), '|');
        assert_eq!(sniff_delimiter("a,b\n1,2\n"), ',');
    }

    #[test]
    fn reads_the_first_sheet_with_data_from_xlsx_text() {
        let text = "[Document: q.xlsx | Type: XLSX | 2 sheets | 5 rows]\n\n── Sheet: Cover ──\nTitle only\n\n── Sheet: Data ──\nitem\tqty\nA\t3\nB\t4\n";
        let t = parse_table(text, "q.xlsx").unwrap();
        assert_eq!(t.sheet.as_deref(), Some("Data"));
        assert_eq!(t.columns, vec!["item", "qty"]);
        assert_eq!(t.rows.len(), 2);
    }

    #[test]
    fn duplicate_and_blank_headers_become_unique() {
        let t = parse_table("a,,a\n1,2,3\n", "x.csv").unwrap();
        assert_eq!(t.columns, vec!["a", "column_2", "a_2"]);
    }

    #[test]
    fn rejects_non_tables() {
        assert!(parse_table("just a paragraph of prose", "x.txt").is_err());
        assert!(parse_table("header,only\n", "x.csv").is_err());
    }

    #[test]
    fn profiles_types_and_statistics() {
        let t = parse_table(CSV, "sales.csv").unwrap();
        let p = profile_table(&t);
        assert_eq!(p.row_count, 4);
        let by = |n: &str| p.columns.iter().find(|c| c.name == n).unwrap().clone();
        assert_eq!(by("region").kind, "text");
        assert_eq!(by("region").top_values[0], ("EMEA".to_string(), 2));
        let amount = by("amount");
        assert_eq!(amount.kind, "number");
        let s = amount.numeric.unwrap();
        assert_eq!(s.min, -50.0);
        assert_eq!(s.max, 1200.0);
        assert_eq!(s.sum, 2250.5);
        assert_eq!(s.median, (300.0 + 800.5) / 2.0);
        assert_eq!(by("date").kind, "date");
        assert_eq!(by("note, quoted").non_empty, 3);
        assert_eq!(p.sample.len(), 4);
    }

    #[test]
    fn aggregates_sum_avg_count_with_limit_and_other_bucket() {
        let t = parse_table(CSV, "sales.csv").unwrap();
        let s = aggregate(&t, &AggregateSpec { x: "region".into(), y: Some("amount".into()), agg: "sum".into(), limit: 0, sort_by_label: false }).unwrap();
        assert_eq!(s.points, vec![("EMEA".to_string(), 1500.0), ("APAC".to_string(), 800.5), ("AMER".to_string(), -50.0)]);
        assert_eq!(s.y_label, "sum(amount)");
        let c = aggregate(&t, &AggregateSpec { x: "region".into(), y: None, agg: "count".into(), limit: 2, sort_by_label: false }).unwrap();
        assert_eq!(c.points, vec![("EMEA".to_string(), 2.0), ("AMER".to_string(), 1.0), ("Other (1 more)".to_string(), 1.0)]);
        assert_eq!(c.groups_total, 3);
        let avg = aggregate(&t, &AggregateSpec { x: "region".into(), y: Some("amount".into()), agg: "avg".into(), limit: 0, sort_by_label: true }).unwrap();
        assert_eq!(avg.points[0].0, "AMER");
        assert_eq!(avg.points.iter().find(|p| p.0 == "EMEA").unwrap().1, 750.0);
        assert!(aggregate(&t, &AggregateSpec { x: "nope".into(), y: None, agg: "count".into(), limit: 0, sort_by_label: false }).is_err());
        assert!(aggregate(&t, &AggregateSpec { x: "region".into(), y: None, agg: "sum".into(), limit: 0, sort_by_label: false }).is_err());
        assert!(aggregate(&t, &AggregateSpec { x: "region".into(), y: Some("amount".into()), agg: "median".into(), limit: 0, sort_by_label: false }).is_err());
    }

    #[test]
    fn non_numeric_y_values_are_skipped_not_zeroed() {
        let t = parse_table("k,v\na,1\na,oops\nb,2\n", "x.csv").unwrap();
        let s = aggregate(&t, &AggregateSpec { x: "k".into(), y: Some("v".into()), agg: "sum".into(), limit: 0, sort_by_label: true }).unwrap();
        assert_eq!(s.points, vec![("a".to_string(), 1.0), ("b".to_string(), 2.0)]);
        assert_eq!(s.skipped_rows, 1);
    }

    #[test]
    fn row_cap_is_enforced_and_reported() {
        let mut text = String::from("i,v\n");
        for i in 0..(MAX_ROWS + 10) { text.push_str(&format!("{i},1\n")); }
        let t = parse_table(&text, "big.csv").unwrap();
        assert_eq!(t.rows.len(), MAX_ROWS);
        assert!(t.truncated);
    }
}
