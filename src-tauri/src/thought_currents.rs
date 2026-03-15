// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Thought Currents — Temporal Pattern Mining in User Intent History
//
// Discovers recurring cycles, seasonal patterns, thought chains, and
// missing connections in the user's query history. Unlike simple frequency
// counting, this analyzes WHEN queries happen relative to each other.

use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A discovered pattern in the user's thinking over time
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThoughtCurrent {
    pub pattern_type: String,
    pub description: String,
    pub confidence: f64,
    pub evidence: Vec<String>,
    pub suggestion: Option<String>,
}

/// Analyze temporal patterns in user intent history.
///
/// # Arguments
/// * `intents` — Tuples of (raw_input, intent_type, created_at ISO string)
///
/// # Returns
/// Up to 10 ThoughtCurrents sorted by confidence DESC.
pub fn analyze_thought_currents(
    intents: &[(String, String, String)],
) -> Vec<ThoughtCurrent> {
    if intents.len() < 5 {
        return vec![];
    }

    let mut results: Vec<ThoughtCurrent> = Vec::new();

    // Parse all timestamps
    let parsed: Vec<(&str, &str, DateTime<Utc>)> = intents
        .iter()
        .filter_map(|(raw, itype, ts)| {
            DateTime::parse_from_rfc3339(ts)
                .ok()
                .map(|dt| (raw.as_str(), itype.as_str(), dt.with_timezone(&Utc)))
        })
        .collect();

    if parsed.is_empty() {
        return vec![];
    }

    // ── (a) Recurring Cycles: same intent_type on same weekday 3+ times across different weeks ──
    {
        // Group by (intent_type, weekday) → set of (year, week)
        let mut weekday_map: HashMap<(String, String), Vec<(i32, u32)>> = HashMap::new();
        for (_, itype, dt) in &parsed {
            let weekday = dt.weekday().to_string();
            let iso_week = dt.iso_week();
            weekday_map
                .entry((itype.to_string(), weekday))
                .or_default()
                .push((iso_week.year(), iso_week.week()));
        }

        for ((itype, weekday), weeks) in &weekday_map {
            // Deduplicate by (year, week)
            let mut unique_weeks = weeks.clone();
            unique_weeks.sort();
            unique_weeks.dedup();

            if unique_weeks.len() >= 3 {
                let confidence = (unique_weeks.len() as f64 / 8.0).min(1.0);
                results.push(ThoughtCurrent {
                    pattern_type: "recurring_cycle".to_string(),
                    description: format!(
                        "You ask about {} every {}",
                        itype, weekday
                    ),
                    confidence,
                    evidence: unique_weeks
                        .iter()
                        .take(5)
                        .map(|(y, w)| format!("{}-W{:02}", y, w))
                        .collect(),
                    suggestion: None,
                });
            }
        }
    }

    // ── (b) Seasonal: same intent_type in same week-of-month 3+ times ──
    {
        let mut monthly_map: HashMap<(String, u32), Vec<(i32, u32)>> = HashMap::new();
        for (_, itype, dt) in &parsed {
            let week_of_month = ((dt.day() - 1) / 7) + 1; // 1-4
            let key = (itype.to_string(), week_of_month.min(4));
            monthly_map
                .entry(key)
                .or_default()
                .push((dt.year(), dt.month()));
        }

        for ((itype, wom), months) in &monthly_map {
            let mut unique_months = months.clone();
            unique_months.sort();
            unique_months.dedup();

            if unique_months.len() >= 3 {
                let week_label = match wom {
                    1 => "first",
                    2 => "second",
                    3 => "third",
                    _ => "fourth",
                };
                let confidence = (unique_months.len() as f64 / 6.0).min(1.0);
                results.push(ThoughtCurrent {
                    pattern_type: "seasonal".to_string(),
                    description: format!(
                        "You tend to explore {} during the {} week of each month",
                        itype, week_label
                    ),
                    confidence,
                    evidence: unique_months
                        .iter()
                        .take(5)
                        .map(|(y, m)| format!("{}-{:02}", y, m))
                        .collect(),
                    suggestion: None,
                });
            }
        }
    }

    // ── (c) Thought Chains: intents that co-occur within 48 hours repeatedly ──
    {
        let mut cooccurrence: HashMap<(String, String), u32> = HashMap::new();
        for i in 0..parsed.len() {
            for j in (i + 1)..parsed.len() {
                let (_, type_a, ts_a) = &parsed[i];
                let (_, type_b, ts_b) = &parsed[j];

                if type_a == type_b {
                    continue;
                }

                let diff = (*ts_a - *ts_b).num_hours().unsigned_abs();
                if diff <= 48 {
                    let pair = if *type_a < *type_b {
                        (type_a.to_string(), type_b.to_string())
                    } else {
                        (type_b.to_string(), type_a.to_string())
                    };
                    *cooccurrence.entry(pair).or_insert(0) += 1;
                }

                // Only look at nearby intents (within 100 entries)
                if j - i > 100 {
                    break;
                }
            }
        }

        for ((type_a, type_b), count) in &cooccurrence {
            if *count >= 2 {
                let confidence = (*count as f64 / 5.0).min(1.0);
                results.push(ThoughtCurrent {
                    pattern_type: "thought_chain".to_string(),
                    description: format!(
                        "{} and {} often come up together within 48 hours",
                        type_a, type_b
                    ),
                    confidence,
                    evidence: vec![format!("Co-occurred {} times", count)],
                    suggestion: Some(format!(
                        "When you think about {}, you might also want to explore {}",
                        type_a, type_b
                    )),
                });
            }
        }
    }

    // ── (d) Missing Connections: frequent types that never appear within 24h of each other ──
    {
        // Count per intent type
        let mut type_counts: HashMap<&str, u32> = HashMap::new();
        for (_, itype, _) in &parsed {
            *type_counts.entry(itype).or_insert(0) += 1;
        }

        let frequent_types: Vec<&str> = type_counts
            .iter()
            .filter(|(_, &c)| c >= 5)
            .map(|(&t, _)| t)
            .collect();

        // Check if any pair of frequent types never appear within 24h
        for i in 0..frequent_types.len() {
            for j in (i + 1)..frequent_types.len() {
                let t1 = frequent_types[i];
                let t2 = frequent_types[j];

                let mut found_close = false;
                'outer: for (_, ta, tsa) in &parsed {
                    if *ta != t1 {
                        continue;
                    }
                    for (_, tb, tsb) in &parsed {
                        if *tb != t2 {
                            continue;
                        }
                        let diff = (*tsa - *tsb).num_hours().unsigned_abs();
                        if diff <= 24 {
                            found_close = true;
                            break 'outer;
                        }
                    }
                }

                if !found_close {
                    results.push(ThoughtCurrent {
                        pattern_type: "missing_connection".to_string(),
                        description: format!(
                            "You frequently explore {} and {} but never together",
                            t1, t2
                        ),
                        confidence: 0.5,
                        evidence: vec![
                            format!("{}: {} queries", t1, type_counts[t1]),
                            format!("{}: {} queries", t2, type_counts[t2]),
                        ],
                        suggestion: Some(format!(
                            "Try connecting {} and {} — they might be related",
                            t1, t2
                        )),
                    });
                }
            }
        }
    }

    // Sort by confidence DESC and limit to 10
    results.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(10);
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_intents_returns_empty() {
        let result = analyze_thought_currents(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_few_intents_returns_empty() {
        let intents = vec![
            ("hello".to_string(), "General".to_string(), "2026-01-01T10:00:00Z".to_string()),
            ("world".to_string(), "General".to_string(), "2026-01-02T10:00:00Z".to_string()),
        ];
        let result = analyze_thought_currents(&intents);
        assert!(result.is_empty());
    }

    #[test]
    fn test_results_limited_to_10() {
        // Generate lots of different patterns
        let mut intents = Vec::new();
        for week in 0..20 {
            for day in 0..7 {
                let date = format!("2025-{:02}-{:02}T10:00:00Z",
                    (week / 4) + 1,
                    (day + 1).min(28)
                );
                intents.push((
                    format!("query about type_{}", day),
                    format!("Type{}", day),
                    date,
                ));
            }
        }
        let result = analyze_thought_currents(&intents);
        assert!(result.len() <= 10);
    }

    #[test]
    fn test_results_sorted_by_confidence() {
        let mut intents = Vec::new();
        // Create a clear recurring pattern
        for week in 0..6 {
            intents.push((
                "debug issue".to_string(),
                "Troubleshooting".to_string(),
                format!("2026-01-{:02}T10:00:00Z", (week * 7 + 1).min(28)),
            ));
        }
        // Add some filler
        for i in 0..10 {
            intents.push((
                format!("random query {}", i),
                "General".to_string(),
                format!("2026-02-{:02}T10:00:00Z", (i + 1).min(28)),
            ));
        }
        let result = analyze_thought_currents(&intents);
        for window in result.windows(2) {
            assert!(window[0].confidence >= window[1].confidence);
        }
    }
}
