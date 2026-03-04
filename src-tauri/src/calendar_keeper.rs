// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// Calendar Keeper — Local-First, Sandbox-Isolated Calendar Agent
//
// The Calendar Keeper reads local .ics (iCalendar) files in READ-ONLY mode,
// extracts today's events, and summarizes them locally via Ollama.
// No calendar data ever leaves the device:
//
//   1. Read .ics file(s) from user-specified directory (read-only)
//   2. Parse VEVENT components — extract summary, start/end, location, description
//   3. Filter to today's events and upcoming 24h window
//   4. Pass event metadata through Sandbox Prism
//   5. LLM summarizes locally via Ollama (conflict detection + time-block suggestions)
//   6. Return structured summary (events list + conflicts + free blocks)
//
// No calendar data is ever sent to the cloud. Files are never modified.
// The user must explicitly enable this feature in Settings.

use chrono::{Local, NaiveDate, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ─── Configuration ─────────────────────────────────────────────────────────────

/// Calendar source configuration provided by the user through Settings.
/// Points to a directory containing .ics files or a single .ics file path.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarConfig {
    /// Path to a directory containing .ics files, or a single .ics file
    pub calendar_path: String,
}

impl CalendarConfig {
    /// Validate that the config has a non-empty path
    pub fn is_valid(&self) -> bool {
        !self.calendar_path.is_empty()
    }
}

// ─── Calendar Event Output ─────────────────────────────────────────────────────

/// A single parsed calendar event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub summary: String,
    pub start: String,
    pub end: String,
    pub location: Option<String>,
    pub description: Option<String>,
    pub all_day: bool,
    /// Parsed start hour (0-23) for conflict detection, -1 if all-day
    pub start_hour: i32,
    /// Parsed end hour (0-23) for conflict detection, -1 if all-day
    pub end_hour: i32,
}

/// A detected scheduling conflict between two events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeConflict {
    pub event_a: String,
    pub event_b: String,
    pub overlap_description: String,
}

/// A suggested free time block
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreeBlock {
    pub start: String,
    pub end: String,
    pub duration_minutes: i64,
}

/// The structured summary returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarSummary {
    /// Number of events today
    pub event_count: usize,
    /// Today's events sorted by start time
    pub events: Vec<CalendarEvent>,
    /// Detected scheduling conflicts
    pub conflicts: Vec<TimeConflict>,
    /// Suggested free time blocks (gaps ≥ 30 min during 8am-8pm)
    pub free_blocks: Vec<FreeBlock>,
    /// LLM-generated natural language summary (produced locally via Ollama)
    pub ai_summary: Option<String>,
    /// Whether the parse succeeded
    pub success: bool,
    /// Human-readable error message if parse failed
    pub error: Option<String>,
    /// How many .ics files were scanned
    pub files_scanned: usize,
}

impl CalendarSummary {
    pub fn error(msg: &str) -> Self {
        Self {
            event_count: 0,
            events: Vec::new(),
            conflicts: Vec::new(),
            free_blocks: Vec::new(),
            ai_summary: None,
            success: false,
            error: Some(msg.to_string()),
            files_scanned: 0,
        }
    }
}

// ─── ICS Parsing (Read-Only) ───────────────────────────────────────────────────

/// Discover all .ics files in a path (file or directory).
pub fn discover_ics_files(path: &str) -> Result<Vec<PathBuf>, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if p.is_file() {
        if p.extension().and_then(|e| e.to_str()) == Some("ics") {
            return Ok(vec![p.to_path_buf()]);
        } else {
            return Err("File is not an .ics file.".into());
        }
    }

    if p.is_dir() {
        let mut files = Vec::new();
        let entries = std::fs::read_dir(p)
            .map_err(|e| format!("Cannot read directory: {}", e))?;
        for entry in entries.flatten() {
            let ep = entry.path();
            if ep.is_file() && ep.extension().and_then(|e| e.to_str()) == Some("ics") {
                files.push(ep);
            }
        }
        if files.is_empty() {
            return Err("No .ics files found in directory.".into());
        }
        return Ok(files);
    }

    Err("Path is neither a file nor a directory.".into())
}

/// Parse a single .ics file and extract events for a specific date.
fn parse_ics_for_date(file_path: &Path, target_date: NaiveDate) -> Vec<CalendarEvent> {
    let content = match std::fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let reader = ical::IcalParser::new(content.as_bytes());
    let mut events = Vec::new();

    for calendar in reader.flatten() {
        for event in calendar.events {
            let mut summary = String::new();
            let mut dtstart = String::new();
            let mut dtend = String::new();
            let mut location: Option<String> = None;
            let mut description: Option<String> = None;

            for prop in &event.properties {
                match prop.name.as_str() {
                    "SUMMARY" => {
                        summary = prop.value.clone().unwrap_or_default();
                    }
                    "DTSTART" => {
                        dtstart = prop.value.clone().unwrap_or_default();
                    }
                    "DTEND" => {
                        dtend = prop.value.clone().unwrap_or_default();
                    }
                    "LOCATION" => {
                        location = prop.value.clone().filter(|v| !v.is_empty());
                    }
                    "DESCRIPTION" => {
                        description = prop.value.clone().filter(|v| !v.is_empty());
                    }
                    _ => {}
                }
            }

            if summary.is_empty() || dtstart.is_empty() {
                continue;
            }

            // Determine if this event falls on the target date
            let (is_today, all_day, start_hour, end_hour) =
                check_event_date(&dtstart, &dtend, target_date);

            if is_today {
                let display_start = format_time_display(&dtstart, all_day);
                let display_end = if dtend.is_empty() {
                    display_start.clone()
                } else {
                    format_time_display(&dtend, all_day)
                };

                // Truncate description to 200 chars for privacy/size
                let desc = description.map(|d| {
                    if d.len() > 200 {
                        format!("{}…", &d[..200])
                    } else {
                        d
                    }
                });

                events.push(CalendarEvent {
                    summary,
                    start: display_start,
                    end: display_end,
                    location,
                    description: desc,
                    all_day,
                    start_hour,
                    end_hour,
                });
            }
        }
    }

    events
}

/// Check if an event's DTSTART falls on the target date.
/// Returns (is_today, all_day, start_hour, end_hour).
fn check_event_date(dtstart: &str, dtend: &str, target: NaiveDate) -> (bool, bool, i32, i32) {
    // All-day events: DTSTART is just a date like "20260304" (8 digits)
    if dtstart.len() == 8 {
        if let Ok(date) = NaiveDate::parse_from_str(dtstart, "%Y%m%d") {
            if date == target {
                return (true, true, -1, -1);
            }
        }
        return (false, true, -1, -1);
    }

    // Timed events: "20260304T093000" or "20260304T093000Z"
    let clean = dtstart.trim_end_matches('Z');
    if let Ok(dt) = NaiveDateTime::parse_from_str(clean, "%Y%m%dT%H%M%S") {
        if dt.date() == target {
            let start_hour = dt.hour() as i32;
            let end_hour = parse_hour(dtend).unwrap_or(start_hour + 1);
            return (true, false, start_hour, end_hour);
        }
    }

    (false, false, -1, -1)
}

/// Parse hour from a DTEND string
fn parse_hour(dtend: &str) -> Option<i32> {
    if dtend.is_empty() || dtend.len() < 9 {
        return None;
    }
    let clean = dtend.trim_end_matches('Z');
    NaiveDateTime::parse_from_str(clean, "%Y%m%dT%H%M%S")
        .ok()
        .map(|dt| dt.hour() as i32)
}

/// Format a DTSTART/DTEND for user display
fn format_time_display(dt_str: &str, all_day: bool) -> String {
    if all_day {
        return "All day".to_string();
    }
    let clean = dt_str.trim_end_matches('Z');
    if let Ok(dt) = NaiveDateTime::parse_from_str(clean, "%Y%m%dT%H%M%S") {
        let hour = dt.hour();
        let minute = dt.minute();
        let period = if hour < 12 { "AM" } else { "PM" };
        let display_hour = if hour == 0 {
            12
        } else if hour > 12 {
            hour - 12
        } else {
            hour
        };
        if minute == 0 {
            format!("{}:00 {}", display_hour, period)
        } else {
            format!("{}:{:02} {}", display_hour, minute, period)
        }
    } else {
        dt_str.to_string()
    }
}

// ─── Core Public API ───────────────────────────────────────────────────────────

/// Read and parse all .ics files from the configured path, returning today's events.
/// This function NEVER modifies any files — read-only access only.
pub fn get_todays_events(config: &CalendarConfig) -> Result<CalendarSummary, String> {
    if !config.is_valid() {
        return Err("Calendar path is not configured. Set the path to your .ics files in Settings.".into());
    }

    let files = discover_ics_files(&config.calendar_path)?;
    let today = Local::now().date_naive();

    let mut all_events: Vec<CalendarEvent> = Vec::new();
    for file in &files {
        let mut file_events = parse_ics_for_date(file, today);
        all_events.append(&mut file_events);
    }

    // Sort by start_hour (all-day events first, then by time)
    all_events.sort_by(|a, b| {
        match (a.all_day, b.all_day) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.start_hour.cmp(&b.start_hour),
        }
    });

    // Detect conflicts (overlapping timed events)
    let conflicts = detect_conflicts(&all_events);

    // Find free blocks (gaps ≥ 30 min between 8am and 8pm)
    let free_blocks = find_free_blocks(&all_events);

    Ok(CalendarSummary {
        event_count: all_events.len(),
        events: all_events,
        conflicts,
        free_blocks,
        ai_summary: None,
        success: true,
        error: None,
        files_scanned: files.len(),
    })
}

/// Detect overlapping events (simple interval overlap check).
pub fn detect_conflicts(events: &[CalendarEvent]) -> Vec<TimeConflict> {
    let mut conflicts = Vec::new();
    let timed: Vec<&CalendarEvent> = events.iter().filter(|e| !e.all_day && e.start_hour >= 0).collect();

    for i in 0..timed.len() {
        for j in (i + 1)..timed.len() {
            let a = timed[i];
            let b = timed[j];
            // Overlap if A starts before B ends AND B starts before A ends
            if a.start_hour < b.end_hour && b.start_hour < a.end_hour {
                conflicts.push(TimeConflict {
                    event_a: a.summary.clone(),
                    event_b: b.summary.clone(),
                    overlap_description: format!(
                        "\"{}\" ({}-{}) overlaps with \"{}\" ({}-{})",
                        a.summary,
                        format_hour(a.start_hour),
                        format_hour(a.end_hour),
                        b.summary,
                        format_hour(b.start_hour),
                        format_hour(b.end_hour),
                    ),
                });
            }
        }
    }

    conflicts
}

/// Find free time blocks (≥ 30 min) during working hours (8am–8pm).
pub fn find_free_blocks(events: &[CalendarEvent]) -> Vec<FreeBlock> {
    let mut busy: Vec<(i32, i32)> = events
        .iter()
        .filter(|e| !e.all_day && e.start_hour >= 0)
        .map(|e| (e.start_hour, e.end_hour))
        .collect();
    busy.sort_by_key(|&(s, _)| s);

    let mut free = Vec::new();
    let work_start = 8;
    let work_end = 20;
    let mut cursor = work_start;

    for (s, e) in &busy {
        let s = *s;
        let e = *e;
        if s > cursor && (s - cursor) >= 1 {
            let dur = (s - cursor) * 60;
            if dur >= 30 {
                free.push(FreeBlock {
                    start: format_hour(cursor),
                    end: format_hour(s),
                    duration_minutes: dur as i64,
                });
            }
        }
        if e > cursor {
            cursor = e;
        }
    }

    // Gap after last event until end of working day
    if cursor < work_end {
        let dur = (work_end - cursor) * 60;
        if dur >= 30 {
            free.push(FreeBlock {
                start: format_hour(cursor),
                end: format_hour(work_end),
                duration_minutes: dur as i64,
            });
        }
    }

    free
}

/// Format an hour (0-23) to a human-readable string like "9 AM" or "2 PM"
fn format_hour(h: i32) -> String {
    let period = if h < 12 { "AM" } else { "PM" };
    let display = if h == 0 {
        12
    } else if h > 12 {
        h - 12
    } else {
        h
    };
    format!("{} {}", display, period)
}

/// Build a prompt for local LLM summarization of today's calendar.
pub fn build_summary_prompt(summary: &CalendarSummary) -> String {
    let mut prompt = format!(
        "You are a private calendar assistant running 100% locally. \
         The user has {} event(s) today. Summarize their day concisely in 2-3 sentences. \
         Highlight any conflicts, tight transitions, or important meetings. \
         Suggest how to use free time blocks effectively.\n\n",
        summary.event_count
    );

    for (i, ev) in summary.events.iter().enumerate() {
        prompt.push_str(&format!(
            "{}. {} — {} to {}",
            i + 1,
            ev.summary,
            ev.start,
            ev.end,
        ));
        if let Some(loc) = &ev.location {
            prompt.push_str(&format!(" ({})", loc));
        }
        prompt.push('\n');
    }

    if !summary.conflicts.is_empty() {
        prompt.push_str("\n⚠️ CONFLICTS:\n");
        for c in &summary.conflicts {
            prompt.push_str(&format!("- {}\n", c.overlap_description));
        }
    }

    if !summary.free_blocks.is_empty() {
        prompt.push_str("\nFree blocks:\n");
        for fb in &summary.free_blocks {
            prompt.push_str(&format!("- {} to {} ({} min)\n", fb.start, fb.end, fb.duration_minutes));
        }
    }

    prompt.push_str(
        "\nRespond with a brief, friendly summary of the day. \
         Start with the event count, then highlight conflicts or tight spots. \
         Suggest the best free block for deep work. Keep it under 100 words."
    );

    prompt
}

/// Produce a quick text summary without LLM (for when Ollama is unavailable).
pub fn fallback_summary(summary: &CalendarSummary) -> String {
    if summary.event_count == 0 {
        return "📅 No events today — your day is wide open!".into();
    }

    let mut parts = vec![format!(
        "📅 {} event{}",
        summary.event_count,
        if summary.event_count == 1 { "" } else { "s" }
    )];

    if !summary.conflicts.is_empty() {
        parts.push(format!("⚠️ {} conflict{}", summary.conflicts.len(), if summary.conflicts.len() == 1 { "" } else { "s" }));
    }

    if let Some(first) = summary.events.first() {
        if first.all_day {
            parts.push(format!("First: \"{}\" (all day)", first.summary));
        } else {
            parts.push(format!("First: \"{}\" at {}", first.summary, first.start));
        }
    }

    if !summary.free_blocks.is_empty() {
        let best = summary.free_blocks.iter().max_by_key(|b| b.duration_minutes).unwrap();
        parts.push(format!("Best free block: {} – {} ({} min)", best.start, best.end, best.duration_minutes));
    }

    parts.join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calendar_config_validation() {
        let valid = CalendarConfig {
            calendar_path: "/home/user/calendars".into(),
        };
        assert!(valid.is_valid());

        let invalid = CalendarConfig {
            calendar_path: "".into(),
        };
        assert!(!invalid.is_valid());
    }

    #[test]
    fn test_error_summary() {
        let s = CalendarSummary::error("File not found");
        assert!(!s.success);
        assert_eq!(s.error, Some("File not found".into()));
        assert_eq!(s.event_count, 0);
    }

    #[test]
    fn test_fallback_summary_zero_events() {
        let s = CalendarSummary {
            event_count: 0,
            events: vec![],
            conflicts: vec![],
            free_blocks: vec![],
            ai_summary: None,
            success: true,
            error: None,
            files_scanned: 1,
        };
        assert!(fallback_summary(&s).contains("wide open"));
    }

    #[test]
    fn test_fallback_summary_with_events() {
        let s = CalendarSummary {
            event_count: 2,
            events: vec![
                CalendarEvent {
                    summary: "Team Standup".into(),
                    start: "9:00 AM".into(),
                    end: "9:30 AM".into(),
                    location: Some("Zoom".into()),
                    description: None,
                    all_day: false,
                    start_hour: 9,
                    end_hour: 10,
                },
                CalendarEvent {
                    summary: "Lunch".into(),
                    start: "12:00 PM".into(),
                    end: "1:00 PM".into(),
                    location: None,
                    description: None,
                    all_day: false,
                    start_hour: 12,
                    end_hour: 13,
                },
            ],
            conflicts: vec![],
            free_blocks: vec![FreeBlock {
                start: "10 AM".into(),
                end: "12 PM".into(),
                duration_minutes: 120,
            }],
            ai_summary: None,
            success: true,
            error: None,
            files_scanned: 1,
        };
        let text = fallback_summary(&s);
        assert!(text.contains("2 events"));
        assert!(text.contains("Team Standup"));
    }

    #[test]
    fn test_detect_conflicts() {
        let events = vec![
            CalendarEvent {
                summary: "Meeting A".into(),
                start: "9:00 AM".into(),
                end: "10:00 AM".into(),
                location: None,
                description: None,
                all_day: false,
                start_hour: 9,
                end_hour: 10,
            },
            CalendarEvent {
                summary: "Meeting B".into(),
                start: "9:30 AM".into(),
                end: "10:30 AM".into(),
                location: None,
                description: None,
                all_day: false,
                start_hour: 9,
                end_hour: 11,
            },
        ];
        let conflicts = detect_conflicts(&events);
        assert_eq!(conflicts.len(), 1);
        assert!(conflicts[0].overlap_description.contains("Meeting A"));
        assert!(conflicts[0].overlap_description.contains("Meeting B"));
    }

    #[test]
    fn test_no_conflicts_non_overlapping() {
        let events = vec![
            CalendarEvent {
                summary: "Morning".into(),
                start: "9:00 AM".into(),
                end: "10:00 AM".into(),
                location: None,
                description: None,
                all_day: false,
                start_hour: 9,
                end_hour: 10,
            },
            CalendarEvent {
                summary: "Afternoon".into(),
                start: "2:00 PM".into(),
                end: "3:00 PM".into(),
                location: None,
                description: None,
                all_day: false,
                start_hour: 14,
                end_hour: 15,
            },
        ];
        let conflicts = detect_conflicts(&events);
        assert!(conflicts.is_empty());
    }

    #[test]
    fn test_find_free_blocks() {
        let events = vec![
            CalendarEvent {
                summary: "Standup".into(),
                start: "9:00 AM".into(),
                end: "10:00 AM".into(),
                location: None,
                description: None,
                all_day: false,
                start_hour: 9,
                end_hour: 10,
            },
            CalendarEvent {
                summary: "Lunch".into(),
                start: "12:00 PM".into(),
                end: "1:00 PM".into(),
                location: None,
                description: None,
                all_day: false,
                start_hour: 12,
                end_hour: 13,
            },
        ];
        let free = find_free_blocks(&events);
        // Expecting: 8-9 (60min), 10-12 (120min), 13-20 (420min)
        assert_eq!(free.len(), 3);
        assert_eq!(free[0].duration_minutes, 60);
        assert_eq!(free[1].duration_minutes, 120);
        assert_eq!(free[2].duration_minutes, 420);
    }

    #[test]
    fn test_build_summary_prompt() {
        let s = CalendarSummary {
            event_count: 1,
            events: vec![CalendarEvent {
                summary: "Board Meeting".into(),
                start: "10:00 AM".into(),
                end: "11:00 AM".into(),
                location: Some("Room 5".into()),
                description: None,
                all_day: false,
                start_hour: 10,
                end_hour: 11,
            }],
            conflicts: vec![],
            free_blocks: vec![],
            ai_summary: None,
            success: true,
            error: None,
            files_scanned: 1,
        };
        let prompt = build_summary_prompt(&s);
        assert!(prompt.contains("1 event"));
        assert!(prompt.contains("Board Meeting"));
        assert!(prompt.contains("Room 5"));
        assert!(prompt.contains("100 words"));
    }

    #[test]
    fn test_check_event_date_allday() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 4).unwrap();
        let (is_today, all_day, sh, eh) = check_event_date("20260304", "", today);
        assert!(is_today);
        assert!(all_day);
        assert_eq!(sh, -1);
        assert_eq!(eh, -1);
    }

    #[test]
    fn test_check_event_date_timed() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 4).unwrap();
        let (is_today, all_day, sh, eh) = check_event_date("20260304T140000", "20260304T150000", today);
        assert!(is_today);
        assert!(!all_day);
        assert_eq!(sh, 14);
        assert_eq!(eh, 15);
    }

    #[test]
    fn test_check_event_date_wrong_day() {
        let today = NaiveDate::from_ymd_opt(2026, 3, 4).unwrap();
        let (is_today, _, _, _) = check_event_date("20260305T140000", "", today);
        assert!(!is_today);
    }

    #[test]
    fn test_format_hour() {
        assert_eq!(format_hour(0), "12 AM");
        assert_eq!(format_hour(9), "9 AM");
        assert_eq!(format_hour(12), "12 PM");
        assert_eq!(format_hour(15), "3 PM");
        assert_eq!(format_hour(20), "8 PM");
    }
}
