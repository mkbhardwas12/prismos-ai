// Artifact Generator — local Word, PowerPoint, PDF, and Excel creation
//
// The LLM produces a bounded structured spec and this module turns it into a
// real local file. Renderers perform no network request; inference and model-
// download boundaries are handled separately. Files are written to the user's
// Downloads folder when available.
//
// - .docx is built with the `docx-rs` crate.
// - .pptx is assembled directly as an Office Open XML package (a zip of XML
//   parts) since there is no mature local pptx-writer crate. The package is a
//   minimal-but-valid deck that PowerPoint, Keynote and LibreOffice all open.
// - .pdf is emitted as a bounded PDF 1.4 document using built-in fonts.
// - .xlsx is assembled as an Office Open XML workbook with inline strings.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

// ─── Spec types (produced by the LLM, deserialized here) ─────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordSection {
    #[serde(default)]
    pub heading: String,
    #[serde(default)]
    pub paragraphs: Vec<String>,
    #[serde(default)]
    pub bullets: Vec<String>,
}

/// Optional user-facing decision record. It contains concise rationale and a
/// verifier verdict, never a raw hidden reasoning trace. `thinking` remains
/// deserializable only for backward compatibility and is intentionally not
/// rendered.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReasoningAppendix {
    /// Short bullet points on key decisions, assumptions, and source limits.
    #[serde(default)]
    pub rationale: Vec<String>,
    /// Legacy field: accepted with a strict bound, but never emitted.
    #[serde(default)]
    pub thinking: String,
    /// A one-line verdict, e.g. "Judge accepted the answer (92%)".
    #[serde(default)]
    pub verdict: String,
}

impl ReasoningAppendix {
    fn is_empty(&self) -> bool {
        self.rationale.iter().all(|r| r.trim().is_empty()) && self.verdict.trim().is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordSpec {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub sections: Vec<WordSection>,
    /// Optional decision record (rendered as a final section).
    #[serde(default)]
    pub reasoning: Option<ReasoningAppendix>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideSpec {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub bullets: Vec<String>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckSpec {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub slides: Vec<SlideSpec>,
    /// Optional decision record (rendered as a final slide).
    #[serde(default)]
    pub reasoning: Option<ReasoningAppendix>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpreadsheetSheet {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub headers: Vec<String>,
    #[serde(default)]
    pub rows: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpreadsheetSpec {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub sheets: Vec<SpreadsheetSheet>,
    /// Optional decision record (rendered as a final worksheet).
    #[serde(default)]
    pub reasoning: Option<ReasoningAppendix>,
}

/// Result returned to the frontend after a file is written.
#[derive(Debug, Clone, Serialize)]
pub struct GeneratedFile {
    pub path: String,
    pub filename: String,
    pub kind: String, // "docx" | "pptx" | "pdf" | "xlsx"
}

pub const MAX_SPEC_JSON_BYTES: usize = 256 * 1024;
const MAX_RENDERED_TEXT_BYTES: usize = 192 * 1024;

fn check_text(value: &str, label: &str, max_bytes: usize, total: &mut usize) -> Result<(), String> {
    if value.len() > max_bytes {
        return Err(format!("{label} exceeds the {max_bytes}-byte limit"));
    }
    *total = total
        .checked_add(value.len())
        .ok_or_else(|| "Document text size overflow".to_string())?;
    if *total > MAX_RENDERED_TEXT_BYTES {
        return Err("Document content exceeds the total rendered-text limit".into());
    }
    Ok(())
}

fn validate_decision_record(
    record: Option<&ReasoningAppendix>,
    total: &mut usize,
) -> Result<(), String> {
    let Some(record) = record else { return Ok(()) };
    if record.rationale.len() > 8 {
        return Err("Decision record may contain at most 8 rationale items".into());
    }
    for (index, item) in record.rationale.iter().enumerate() {
        check_text(
            item,
            &format!("Decision record item {}", index + 1),
            1_000,
            total,
        )?;
    }
    check_text(&record.verdict, "Decision record verdict", 1_000, total)?;
    // The legacy field is not rendered, but still bound before accepting an old spec.
    if record.thinking.len() > 4_096 {
        return Err("Legacy reasoning field exceeds the compatibility limit".into());
    }
    Ok(())
}

pub fn validate_word_spec(spec: &WordSpec) -> Result<(), String> {
    if spec.title.trim().is_empty() {
        return Err("Document title is required".into());
    }
    if spec.sections.is_empty() || spec.sections.len() > 12 {
        return Err("Document must contain 1 to 12 sections".into());
    }
    let mut total = 0usize;
    check_text(&spec.title, "Document title", 240, &mut total)?;
    check_text(&spec.subtitle, "Document subtitle", 500, &mut total)?;
    for (section_index, section) in spec.sections.iter().enumerate() {
        if section.paragraphs.len() > 8 || section.bullets.len() > 12 {
            return Err(format!(
                "Section {} exceeds paragraph or bullet count limits",
                section_index + 1
            ));
        }
        check_text(
            &section.heading,
            &format!("Section {} heading", section_index + 1),
            500,
            &mut total,
        )?;
        for (index, paragraph) in section.paragraphs.iter().enumerate() {
            check_text(
                paragraph,
                &format!("Section {} paragraph {}", section_index + 1, index + 1),
                8_000,
                &mut total,
            )?;
        }
        for (index, bullet) in section.bullets.iter().enumerate() {
            check_text(
                bullet,
                &format!("Section {} bullet {}", section_index + 1, index + 1),
                1_000,
                &mut total,
            )?;
        }
    }
    validate_decision_record(spec.reasoning.as_ref(), &mut total)
}

pub fn validate_deck_spec(spec: &DeckSpec) -> Result<(), String> {
    if spec.title.trim().is_empty() {
        return Err("Presentation title is required".into());
    }
    if spec.slides.is_empty() || spec.slides.len() > 12 {
        return Err("Presentation must contain 1 to 12 content slides".into());
    }
    let mut total = 0usize;
    check_text(&spec.title, "Presentation title", 240, &mut total)?;
    check_text(&spec.subtitle, "Presentation subtitle", 500, &mut total)?;
    for (slide_index, slide) in spec.slides.iter().enumerate() {
        if slide.bullets.len() > 8 {
            return Err(format!("Slide {} has more than 8 bullets", slide_index + 1));
        }
        check_text(
            &slide.title,
            &format!("Slide {} title", slide_index + 1),
            500,
            &mut total,
        )?;
        for (index, bullet) in slide.bullets.iter().enumerate() {
            check_text(
                bullet,
                &format!("Slide {} bullet {}", slide_index + 1, index + 1),
                1_000,
                &mut total,
            )?;
        }
        check_text(
            &slide.notes,
            &format!("Slide {} notes", slide_index + 1),
            4_000,
            &mut total,
        )?;
    }
    validate_decision_record(spec.reasoning.as_ref(), &mut total)
}

pub fn validate_spreadsheet_spec(spec: &SpreadsheetSpec) -> Result<(), String> {
    if spec.title.trim().is_empty() {
        return Err("Workbook title is required".into());
    }
    if spec.sheets.is_empty() || spec.sheets.len() > 8 {
        return Err("Workbook must contain 1 to 8 worksheets".into());
    }
    let mut total = 0usize;
    check_text(&spec.title, "Workbook title", 240, &mut total)?;
    check_text(&spec.subtitle, "Workbook subtitle", 500, &mut total)?;
    for (sheet_index, sheet) in spec.sheets.iter().enumerate() {
        if sheet.name.trim().is_empty() {
            return Err(format!("Worksheet {} name is required", sheet_index + 1));
        }
        if sheet.headers.is_empty() || sheet.headers.len() > 40 {
            return Err(format!(
                "Worksheet {} must contain 1 to 40 columns",
                sheet_index + 1
            ));
        }
        if sheet.rows.len() > 1_000 {
            return Err(format!(
                "Worksheet {} exceeds the 1000-row limit",
                sheet_index + 1
            ));
        }
        check_text(
            &sheet.name,
            &format!("Worksheet {} name", sheet_index + 1),
            100,
            &mut total,
        )?;
        for (column_index, header) in sheet.headers.iter().enumerate() {
            check_text(
                header,
                &format!(
                    "Worksheet {} column {} header",
                    sheet_index + 1,
                    column_index + 1
                ),
                500,
                &mut total,
            )?;
        }
        for (row_index, row) in sheet.rows.iter().enumerate() {
            if row.len() > sheet.headers.len() {
                return Err(format!(
                    "Worksheet {} row {} has more cells than headers",
                    sheet_index + 1,
                    row_index + 1
                ));
            }
            for (column_index, cell) in row.iter().enumerate() {
                check_text(
                    cell,
                    &format!(
                        "Worksheet {} row {} column {}",
                        sheet_index + 1,
                        row_index + 1,
                        column_index + 1
                    ),
                    2_000,
                    &mut total,
                )?;
            }
        }
    }
    validate_decision_record(spec.reasoning.as_ref(), &mut total)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Escape a string for safe inclusion in XML content/attribute values.
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Turn a document title into a safe file stem (no path separators / weird chars).
fn safe_stem(title: &str, fallback: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                ' '
            }
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join("-");
    let trimmed = collapsed.trim_matches('-');
    let stem = if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    };
    // Keep filenames reasonable
    stem.chars().take(60).collect()
}

/// Resolve the output directory, preferring Downloads, then Desktop, then home.
fn output_dir() -> PathBuf {
    dirs::download_dir()
        .or_else(dirs::desktop_dir)
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Atomically reserve a unique output file. `create_new` prevents a race from
/// turning a previously absent candidate into an overwrite or symlink target.
fn create_unique_file_in_dir(
    dir: &Path,
    stem: &str,
    ext: &str,
) -> Result<(PathBuf, std::fs::File), String> {
    const MAX_COLLISIONS: u32 = 10_000;

    for sequence in 1..=MAX_COLLISIONS {
        let filename = if sequence == 1 {
            format!("{stem}.{ext}")
        } else {
            format!("{stem}-{sequence}.{ext}")
        };
        let candidate = dir.join(filename);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "Failed to reserve generated document '{}': {error}",
                    candidate.display()
                ));
            }
        }
    }

    Err(format!(
        "Could not reserve a unique generated document after {MAX_COLLISIONS} attempts"
    ))
}

// ─── Word (.docx) ────────────────────────────────────────────────────────────

/// Generate a Word document from a spec. Returns the written file's metadata.
pub fn generate_docx(spec: &WordSpec) -> Result<GeneratedFile, String> {
    generate_docx_in_dir(spec, &output_dir())
}

/// Generate a Word document inside an explicit, pre-created output directory.
/// Project Review uses this to keep its sole artifact outside the approved
/// source root instead of assuming Downloads is always disjoint.
pub fn generate_docx_in_dir(
    spec: &WordSpec,
    output_directory: &Path,
) -> Result<GeneratedFile, String> {
    use docx_rs::*;

    validate_word_spec(spec)?;
    let metadata = std::fs::symlink_metadata(output_directory)
        .map_err(|e| format!("Could not inspect document output directory: {e}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Document output must be a real, non-symlink directory".into());
    }

    let mut docx = Docx::new();

    // Title (centered, large, bold, dark slate)
    if !spec.title.trim().is_empty() {
        docx = docx.add_paragraph(
            Paragraph::new().align(AlignmentType::Center).add_run(
                Run::new()
                    .add_text(&spec.title)
                    .bold()
                    .size(56)
                    .color("0F172A"),
            ),
        );
    }

    // Subtitle (centered, medium, accent color)
    if !spec.subtitle.trim().is_empty() {
        docx = docx.add_paragraph(
            Paragraph::new().align(AlignmentType::Center).add_run(
                Run::new()
                    .add_text(&spec.subtitle)
                    .italic()
                    .size(28)
                    .color("6366F1"),
            ),
        );
    }

    // Spacer after the title block
    if !spec.title.trim().is_empty() || !spec.subtitle.trim().is_empty() {
        docx = docx.add_paragraph(Paragraph::new());
    }

    for section in &spec.sections {
        if !section.heading.trim().is_empty() {
            docx = docx.add_paragraph(
                Paragraph::new().add_run(
                    Run::new()
                        .add_text(&section.heading)
                        .bold()
                        .size(32)
                        .color("4F46E5"),
                ),
            );
        }
        for para in &section.paragraphs {
            if para.trim().is_empty() {
                continue;
            }
            docx = docx.add_paragraph(
                Paragraph::new().add_run(Run::new().add_text(para).size(24).color("334155")),
            );
        }
        for bullet in &section.bullets {
            if bullet.trim().is_empty() {
                continue;
            }
            docx = docx.add_paragraph(
                Paragraph::new().add_run(
                    Run::new()
                        .add_text(format!("▪  {bullet}"))
                        .size(24)
                        .color("334155"),
                ),
            );
        }
        // Blank line between sections
        docx = docx.add_paragraph(Paragraph::new());
    }

    // ── Optional user-facing decision record ──
    if let Some(reasoning) = spec.reasoning.as_ref().filter(|r| !r.is_empty()) {
        docx = docx.add_paragraph(
            Paragraph::new().add_run(
                Run::new()
                    .add_text("Decision Record")
                    .bold()
                    .size(32)
                    .color("4F46E5"),
            ),
        );
        if !reasoning.verdict.trim().is_empty() {
            docx = docx.add_paragraph(
                Paragraph::new().add_run(
                    Run::new()
                        .add_text(&reasoning.verdict)
                        .italic()
                        .size(24)
                        .color("6366F1"),
                ),
            );
        }
        for point in &reasoning.rationale {
            if point.trim().is_empty() {
                continue;
            }
            docx = docx.add_paragraph(
                Paragraph::new().add_run(
                    Run::new()
                        .add_text(format!("▪  {point}"))
                        .size(24)
                        .color("334155"),
                ),
            );
        }
        docx = docx.add_paragraph(Paragraph::new());
    }

    let stem = safe_stem(&spec.title, "document");
    let (path, file) = create_unique_file_in_dir(output_directory, &stem, "docx")?;
    docx.build()
        .pack(file)
        .map_err(|e| format!("Failed to write docx: {e}"))?;

    Ok(GeneratedFile {
        filename: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: path.to_string_lossy().to_string(),
        kind: "docx".to_string(),
    })
}

// ─── PowerPoint (.pptx) ──────────────────────────────────────────────────────

/// Generate a PowerPoint deck from a spec. Returns the written file's metadata.
pub fn generate_pptx(spec: &DeckSpec) -> Result<GeneratedFile, String> {
    validate_deck_spec(spec)?;

    // Assemble the slide list: an optional title slide followed by content slides.
    let mut slides: Vec<RenderSlide> = Vec::new();
    if !spec.title.trim().is_empty() {
        slides.push(RenderSlide {
            title: spec.title.clone(),
            subtitle: spec.subtitle.clone(),
            bullets: Vec::new(),
            is_title: true,
        });
    }
    for s in &spec.slides {
        slides.push(RenderSlide {
            title: s.title.clone(),
            subtitle: String::new(),
            bullets: s.bullets.clone(),
            is_title: false,
        });
    }

    // ── Optional final decision-record slide ──
    if let Some(reasoning) = spec.reasoning.as_ref().filter(|r| !r.is_empty()) {
        let mut bullets: Vec<String> = Vec::new();
        if !reasoning.verdict.trim().is_empty() {
            bullets.push(reasoning.verdict.trim().to_string());
        }
        for point in &reasoning.rationale {
            if !point.trim().is_empty() {
                bullets.push(point.trim().to_string());
            }
        }
        if !bullets.is_empty() {
            slides.push(RenderSlide {
                title: "Decision Record".to_string(),
                subtitle: String::new(),
                bullets: bullets.into_iter().take(8).collect(),
                is_title: false,
            });
        }
    }

    if slides.is_empty() {
        return Err("Presentation has no slides".to_string());
    }

    let stem = safe_stem(&spec.title, "presentation");
    let (path, file) = create_unique_file_in_dir(&output_dir(), &stem, "pptx")?;

    write_pptx(file, &slides)?;

    Ok(GeneratedFile {
        filename: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: path.to_string_lossy().to_string(),
        kind: "pptx".to_string(),
    })
}

/// A slide prepared for rendering, tagged with which layout to use.
struct RenderSlide {
    title: String,
    subtitle: String,
    bullets: Vec<String>,
    is_title: bool,
}

/// Write the full OOXML presentation package to an atomically reserved file.
fn write_pptx(file: std::fs::File, slides: &[RenderSlide]) -> Result<(), String> {
    use zip::write::SimpleFileOptions;

    let mut zip = zip::ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut write = |name: &str, content: &str| -> Result<(), String> {
        zip.start_file(name, opts)
            .map_err(|e| format!("zip start_file {name}: {e}"))?;
        zip.write_all(content.as_bytes())
            .map_err(|e| format!("zip write {name}: {e}"))?;
        Ok(())
    };

    let n = slides.len();

    write("[Content_Types].xml", &content_types_xml(n))?;
    write("_rels/.rels", ROOT_RELS)?;
    write("ppt/presentation.xml", &presentation_xml(n))?;
    write("ppt/_rels/presentation.xml.rels", &presentation_rels_xml(n))?;
    write("ppt/presProps.xml", PRES_PROPS)?;
    write("ppt/theme/theme1.xml", THEME1)?;
    write("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER)?;
    write(
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        SLIDE_MASTER_RELS,
    )?;
    write("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT)?;
    write(
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        SLIDE_LAYOUT_RELS,
    )?;

    let total = slides.len();
    for (i, slide) in slides.iter().enumerate() {
        let idx = i + 1;
        write(
            &format!("ppt/slides/slide{idx}.xml"),
            &slide_xml(slide, idx, total),
        )?;
        write(&format!("ppt/slides/_rels/slide{idx}.xml.rels"), SLIDE_RELS)?;
    }

    zip.finish().map_err(|e| format!("zip finish: {e}"))?;
    Ok(())
}

fn content_types_xml(slide_count: usize) -> String {
    let mut overrides = String::new();
    for i in 1..=slide_count {
        overrides.push_str(&format!(
            "<Override PartName=\"/ppt/slides/slide{i}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>"
        ));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
{overrides}</Types>"#
    )
}

fn presentation_xml(slide_count: usize) -> String {
    let mut sld_ids = String::new();
    for i in 0..slide_count {
        // r:id for slides starts at rId2 (rId1 is the slide master)
        let rid = i + 2;
        let sld_id = 256 + i;
        sld_ids.push_str(&format!("<p:sldId id=\"{sld_id}\" r:id=\"rId{rid}\"/>"));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>{sld_ids}</p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>"#
    )
}

fn presentation_rels_xml(slide_count: usize) -> String {
    let mut rels = String::new();
    // rId1 -> slide master
    rels.push_str(r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>"#);
    // rId2..rId(n+1) -> slides
    for i in 0..slide_count {
        let rid = i + 2;
        let idx = i + 1;
        rels.push_str(&format!(
            r#"<Relationship Id="rId{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{idx}.xml"/>"#
        ));
    }
    // theme + presProps get the next ids
    let theme_rid = slide_count + 2;
    let props_rid = slide_count + 3;
    rels.push_str(&format!(
        r#"<Relationship Id="rId{theme_rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>"#
    ));
    rels.push_str(&format!(
        r#"<Relationship Id="rId{props_rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>"#
    ));
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>"#
    )
}

/// Route a slide to the hero (title) layout or the content layout.
fn slide_xml(slide: &RenderSlide, index: usize, _total: usize) -> String {
    if slide.is_title {
        title_slide_xml(slide)
    } else {
        content_slide_xml(slide, index)
    }
}

const SLD_OPEN: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">"#;

const SPTREE_HEAD: &str = r#"<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>"#;

/// Hero title slide: full-bleed indigo→violet gradient, accent bar, big title,
/// subtitle, and a subtle local-privacy footer.
fn title_slide_xml(slide: &RenderSlide) -> String {
    let title = xml_escape(&slide.title);

    let subtitle_shape = if slide.subtitle.trim().is_empty() {
        String::new()
    } else {
        let subtitle = xml_escape(&slide.subtitle);
        format!(
            r#"<p:sp>
<p:nvSpPr><p:cNvPr id="4" name="Subtitle"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="4526280"/><a:ext cx="10820400" cy="762000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:r><a:rPr lang="en-US" sz="2400" dirty="0"><a:solidFill><a:srgbClr val="E0E7FF"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>{subtitle}</a:t></a:r></a:p>
</p:txBody>
</p:sp>"#
        )
    };

    format!(
        r#"{SLD_OPEN}
<p:cSld>
<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="4F46E5"/></a:gs><a:gs pos="100000"><a:srgbClr val="7C3AED"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree>
{SPTREE_HEAD}
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="AccentBar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="688975" y="2590800"/><a:ext cx="1152144" cy="54864"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="3" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="2743200"/><a:ext cx="10820400" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:r><a:rPr lang="en-US" sz="5400" b="1" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>{title}</a:t></a:r></a:p>
</p:txBody>
</p:sp>
{subtitle_shape}
<p:sp>
<p:nvSpPr><p:cNvPr id="5" name="Brand"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="6172200"/><a:ext cx="10820400" cy="381000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:r><a:rPr lang="en-US" sz="1100" dirty="0"><a:solidFill><a:srgbClr val="C7D2FE"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>Generated by PrismOS-AI on this device</a:t></a:r></a:p>
</p:txBody>
</p:sp>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"#
    )
}

/// Content slide: white canvas, left gradient accent bar, dark bold title with
/// an accent underline, square accent bullets, footer rule + slide number.
fn content_slide_xml(slide: &RenderSlide, index: usize) -> String {
    let title = xml_escape(&slide.title);

    let mut body_paras = String::new();
    for bullet in &slide.bullets {
        if bullet.trim().is_empty() {
            continue;
        }
        let text = xml_escape(bullet);
        body_paras.push_str(&format!(
            r#"<a:p><a:pPr marL="342900" indent="-342900"><a:lnSpc><a:spcPct val="130000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buClr><a:srgbClr val="6366F1"/></a:buClr><a:buSzPct val="80000"/><a:buFont typeface="Arial"/><a:buChar char="&#9642;"/></a:pPr><a:r><a:rPr lang="en-US" sz="2000" dirty="0"><a:solidFill><a:srgbClr val="334155"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>{text}</a:t></a:r></a:p>"#
        ));
    }
    if body_paras.is_empty() {
        body_paras.push_str(r#"<a:p><a:endParaRPr lang="en-US"/></a:p>"#);
    }

    format!(
        r#"{SLD_OPEN}
<p:cSld>
<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree>
{SPTREE_HEAD}
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="SideBar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="137160" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="4F46E5"/></a:gs><a:gs pos="100000"><a:srgbClr val="7C3AED"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill><a:ln><a:noFill/></a:ln></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="3" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="502920"/><a:ext cx="10820400" cy="925200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr anchor="t"/><a:lstStyle/>
<a:p><a:r><a:rPr lang="en-US" sz="3600" b="1" dirty="0"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>{title}</a:t></a:r></a:p>
</p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="4" name="Underline"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="693420" y="1508760"/><a:ext cx="1188720" cy="51435"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="6366F1"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="5" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="1783080"/><a:ext cx="10820400" cy="4419600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
{body_paras}
</p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="6" name="FooterLine"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="6416040"/><a:ext cx="10820400" cy="12700"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="7" name="PageNum"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="10820400" y="6479540"/><a:ext cx="685800" cy="304800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:pPr algn="r"/><a:r><a:rPr lang="en-US" sz="1100" dirty="0"><a:solidFill><a:srgbClr val="94A3B8"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>{index}</a:t></a:r></a:p>
</p:txBody>
</p:sp>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"#
    )
}

// ─── Static OOXML parts (master / layout / theme / props / rels) ─────────────

const ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>"#;

const PRES_PROPS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>"#;

const SLIDE_MASTER: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld>
<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree>
</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle>
<a:lvl1pPr algn="ctr"><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr>
</p:titleStyle>
<p:bodyStyle>
<a:lvl1pPr marL="285750" indent="-285750"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>
</p:bodyStyle>
<p:otherStyle>
<a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>
</p:otherStyle>
</p:txStyles>
</p:sldMaster>"#;

const SLIDE_MASTER_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>"#;

const SLIDE_LAYOUT: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld name="Blank">
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>"#;

const SLIDE_LAYOUT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>"#;

const SLIDE_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>"#;

const THEME1: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
<a:themeElements>
<a:clrScheme name="Office">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2>
<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1>
<a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
<a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
<a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink>
<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Office">
<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Office">
<a:fillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:fillStyleLst>
<a:lnStyleLst>
<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
</a:lnStyleLst>
<a:effectStyleLst>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
</a:effectStyleLst>
<a:bgFillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>"#;

// ─── PDF (.pdf) ─────────────────────────────────────────────────────────────

#[derive(Clone)]
struct PdfLine {
    text: String,
    size: f32,
    bold: bool,
    gap_after: f32,
}

fn pdf_ascii(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            '\u{2013}' | '\u{2014}' | '\u{2212}' => '-',
            '\u{2018}' | '\u{2019}' => '\'',
            '\u{201c}' | '\u{201d}' => '"',
            '\u{2022}' | '\u{25aa}' => '-',
            '\n' | '\r' | '\t' => ' ',
            value if value.is_ascii() && !value.is_ascii_control() => value,
            _ => '?',
        })
        .collect()
}

fn pdf_escape(value: &str) -> String {
    pdf_ascii(value)
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

fn wrap_text(value: &str, maximum_characters: usize) -> Vec<String> {
    let words = value.split_whitespace().collect::<Vec<_>>();
    if words.is_empty() {
        return vec![String::new()];
    }
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in words {
        let word_length = word.chars().count();
        if word_length > maximum_characters {
            if !current.is_empty() {
                lines.push(std::mem::take(&mut current));
            }
            let characters = word.chars().collect::<Vec<_>>();
            for chunk in characters.chunks(maximum_characters) {
                lines.push(chunk.iter().collect());
            }
            continue;
        }
        let projected = current.chars().count() + usize::from(!current.is_empty()) + word_length;
        if projected > maximum_characters && !current.is_empty() {
            lines.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

fn push_wrapped_pdf_lines(
    output: &mut Vec<PdfLine>,
    value: &str,
    maximum_characters: usize,
    size: f32,
    bold: bool,
    gap_after: f32,
) {
    let wrapped = wrap_text(value, maximum_characters);
    let final_index = wrapped.len().saturating_sub(1);
    for (index, text) in wrapped.into_iter().enumerate() {
        output.push(PdfLine {
            text,
            size,
            bold,
            gap_after: if index == final_index { gap_after } else { 2.0 },
        });
    }
}

fn pdf_lines(spec: &WordSpec) -> Vec<PdfLine> {
    let mut lines = Vec::new();
    push_wrapped_pdf_lines(&mut lines, &spec.title, 48, 22.0, true, 10.0);
    if !spec.subtitle.trim().is_empty() {
        push_wrapped_pdf_lines(&mut lines, &spec.subtitle, 78, 12.0, false, 18.0);
    }
    for section in &spec.sections {
        if !section.heading.trim().is_empty() {
            push_wrapped_pdf_lines(&mut lines, &section.heading, 66, 15.0, true, 8.0);
        }
        for paragraph in &section.paragraphs {
            push_wrapped_pdf_lines(&mut lines, paragraph, 92, 10.5, false, 8.0);
        }
        for bullet in &section.bullets {
            push_wrapped_pdf_lines(&mut lines, &format!("- {bullet}"), 88, 10.5, false, 4.0);
        }
        lines.push(PdfLine {
            text: String::new(),
            size: 7.0,
            bold: false,
            gap_after: 4.0,
        });
    }
    if let Some(reasoning) = spec.reasoning.as_ref().filter(|record| !record.is_empty()) {
        push_wrapped_pdf_lines(&mut lines, "Decision Record", 66, 15.0, true, 8.0);
        if !reasoning.verdict.trim().is_empty() {
            push_wrapped_pdf_lines(&mut lines, &reasoning.verdict, 88, 10.5, false, 5.0);
        }
        for point in &reasoning.rationale {
            push_wrapped_pdf_lines(&mut lines, &format!("- {point}"), 88, 10.5, false, 4.0);
        }
    }
    lines
}

fn write_pdf(mut file: std::fs::File, spec: &WordSpec) -> Result<(), String> {
    let mut pages: Vec<Vec<(PdfLine, f32)>> = vec![Vec::new()];
    let mut y = 738.0_f32;
    for line in pdf_lines(spec) {
        let height = line.size * 1.35 + line.gap_after;
        if y - height < 54.0 && !pages.last().is_some_and(Vec::is_empty) {
            pages.push(Vec::new());
            y = 738.0;
        }
        pages
            .last_mut()
            .expect("PDF always has a page")
            .push((line, y));
        y -= height;
    }

    let page_count = pages.len();
    let regular_font_id = 3 + page_count * 2;
    let bold_font_id = regular_font_id + 1;
    let object_count = bold_font_id;
    let mut output = Vec::<u8>::new();
    output.extend_from_slice(b"%PDF-1.4\n%PrismOS\n");
    let mut offsets = vec![0usize; object_count + 1];

    let mut append_object = |id: usize, body: &[u8]| {
        offsets[id] = output.len();
        output.extend_from_slice(format!("{id} 0 obj\n").as_bytes());
        output.extend_from_slice(body);
        output.extend_from_slice(b"\nendobj\n");
    };

    append_object(1, b"<< /Type /Catalog /Pages 2 0 R >>");
    let kids = (0..page_count)
        .map(|index| format!("{} 0 R", 3 + index * 2))
        .collect::<Vec<_>>()
        .join(" ");
    append_object(
        2,
        format!("<< /Type /Pages /Kids [{kids}] /Count {page_count} >>").as_bytes(),
    );

    for (page_index, lines) in pages.iter().enumerate() {
        let page_id = 3 + page_index * 2;
        let content_id = page_id + 1;
        append_object(
            page_id,
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {regular_font_id} 0 R /F2 {bold_font_id} 0 R >> >> /Contents {content_id} 0 R >>"
            )
            .as_bytes(),
        );
        let mut stream = String::new();
        for (line, line_y) in lines {
            if line.text.is_empty() {
                continue;
            }
            let font = if line.bold { "F2" } else { "F1" };
            stream.push_str(&format!(
                "BT /{font} {:.1} Tf 0.10 0.14 0.24 rg 54 {:.1} Td ({}) Tj ET\n",
                line.size,
                line_y,
                pdf_escape(&line.text)
            ));
        }
        let stream_body = format!(
            "<< /Length {} >>\nstream\n{}endstream",
            stream.len(),
            stream
        );
        append_object(content_id, stream_body.as_bytes());
    }
    append_object(
        regular_font_id,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    );
    append_object(
        bold_font_id,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    );

    let xref_offset = output.len();
    output.extend_from_slice(format!("xref\n0 {}\n", object_count + 1).as_bytes());
    output.extend_from_slice(b"0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        output.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    output.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
            object_count + 1
        )
        .as_bytes(),
    );
    file.write_all(&output)
        .map_err(|error| format!("Failed to write PDF: {error}"))?;
    file.flush()
        .map_err(|error| format!("Failed to flush PDF: {error}"))
}

pub fn generate_pdf(spec: &WordSpec) -> Result<GeneratedFile, String> {
    generate_pdf_in_dir(spec, &output_dir())
}

fn generate_pdf_in_dir(spec: &WordSpec, directory: &Path) -> Result<GeneratedFile, String> {
    validate_word_spec(spec)?;
    let metadata = std::fs::symlink_metadata(directory)
        .map_err(|error| format!("Could not inspect PDF output directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("PDF output must be a real, non-symlink directory".into());
    }
    let stem = safe_stem(&spec.title, "document");
    let (path, file) = create_unique_file_in_dir(directory, &stem, "pdf")?;
    write_pdf(file, spec)?;
    Ok(GeneratedFile {
        filename: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: path.to_string_lossy().to_string(),
        kind: "pdf".into(),
    })
}

// ─── Excel (.xlsx) ──────────────────────────────────────────────────────────

fn xlsx_column_name(mut index: usize) -> String {
    let mut output = String::new();
    loop {
        output.insert(0, (b'A' + (index % 26) as u8) as char);
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    output
}

fn safe_sheet_name(value: &str, fallback: &str) -> String {
    let cleaned = value
        .chars()
        .map(|character| {
            if matches!(character, '[' | ']' | ':' | '*' | '?' | '/' | '\\')
                || character.is_control()
            {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let trimmed = cleaned.trim().trim_matches('\'');
    let candidate = if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    };
    candidate.chars().take(31).collect()
}

fn unique_sheet_names(sheets: &[SpreadsheetSheet]) -> Vec<String> {
    let mut names: Vec<String> = Vec::with_capacity(sheets.len());
    for (index, sheet) in sheets.iter().enumerate() {
        let fallback = format!("Sheet {}", index + 1);
        let base = safe_sheet_name(&sheet.name, &fallback);
        let mut candidate = base.clone();
        let mut sequence = 2usize;
        while names
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&candidate))
        {
            let suffix = format!(" {sequence}");
            let keep = 31usize.saturating_sub(suffix.chars().count());
            candidate = format!("{}{}", base.chars().take(keep).collect::<String>(), suffix);
            sequence += 1;
        }
        names.push(candidate);
    }
    names
}

fn xlsx_cell(reference: &str, value: &str, style: usize) -> String {
    format!(
        r#"<c r="{reference}" t="inlineStr" s="{style}"><is><t xml:space="preserve">{}</t></is></c>"#,
        xml_escape(value)
    )
}

fn worksheet_xml(sheet: &SpreadsheetSheet, title: &str, subtitle: &str) -> String {
    let last_column = xlsx_column_name(sheet.headers.len().saturating_sub(1));
    let final_row = 4 + sheet.rows.len().max(1);
    let mut widths = sheet
        .headers
        .iter()
        .map(|header| header.chars().count())
        .collect::<Vec<_>>();
    for row in &sheet.rows {
        for (index, cell) in row.iter().enumerate() {
            widths[index] = widths[index].max(cell.chars().count());
        }
    }
    let columns = widths
        .iter()
        .enumerate()
        .map(|(index, width)| {
            format!(
                r#"<col min="{}" max="{}" width="{}" customWidth="1"/>"#,
                index + 1,
                index + 1,
                (*width + 3).clamp(12, 45)
            )
        })
        .collect::<String>();

    let headers = sheet
        .headers
        .iter()
        .enumerate()
        .map(|(index, header)| xlsx_cell(&format!("{}4", xlsx_column_name(index)), header, 1))
        .collect::<String>();
    let rows = sheet
        .rows
        .iter()
        .enumerate()
        .map(|(row_index, row)| {
            let row_number = row_index + 5;
            let cells = row
                .iter()
                .enumerate()
                .map(|(column_index, value)| {
                    xlsx_cell(
                        &format!("{}{row_number}", xlsx_column_name(column_index)),
                        value,
                        0,
                    )
                })
                .collect::<String>();
            format!(r#"<row r="{row_number}">{cells}</row>"#)
        })
        .collect::<String>();
    let merges = if sheet.headers.len() > 1 {
        format!(
            r#"<mergeCells count="2"><mergeCell ref="A1:{last_column}1"/><mergeCell ref="A2:{last_column}2"/></mergeCells>"#
        )
    } else {
        String::new()
    };

    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:{last_column}{final_row}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/><cols>{columns}</cols>
<sheetData>
<row r="1" ht="28" customHeight="1">{}</row>
<row r="2" ht="22" customHeight="1">{}</row>
<row r="4" ht="24" customHeight="1">{headers}</row>
{rows}
</sheetData>{merges}
<autoFilter ref="A4:{last_column}{final_row}"/>
</worksheet>"#,
        xlsx_cell("A1", title, 2),
        xlsx_cell("A2", subtitle, 3),
    )
}

fn workbook_xml(names: &[String]) -> String {
    let sheets = names
        .iter()
        .enumerate()
        .map(|(index, name)| {
            format!(
                r#"<sheet name="{}" sheetId="{}" r:id="rId{}"/>"#,
                xml_escape(name),
                index + 1,
                index + 1
            )
        })
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{sheets}</sheets></workbook>"#
    )
}

fn workbook_rels_xml(sheet_count: usize) -> String {
    let sheets = (0..sheet_count)
        .map(|index| {
            format!(
                r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{}.xml"/>"#,
                index + 1,
                index + 1
            )
        })
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{sheets}<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#,
        sheet_count + 1
    )
}

fn xlsx_content_types(sheet_count: usize) -> String {
    let sheets = (1..=sheet_count)
        .map(|index| {
            format!(
                r#"<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#
            )
        })
        .collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>{sheets}
</Types>"#
    )
}

const XLSX_ROOT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#;

const XLSX_STYLES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FF1E293B"/><sz val="16"/><name val="Aptos Display"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>"#;

fn write_xlsx(mut file: std::fs::File, spec: &SpreadsheetSpec) -> Result<(), String> {
    use zip::write::SimpleFileOptions;

    let mut sheets = spec.sheets.clone();
    if let Some(reasoning) = spec.reasoning.as_ref().filter(|record| !record.is_empty()) {
        let mut rows = Vec::new();
        if !reasoning.verdict.trim().is_empty() {
            rows.push(vec!["Verdict".into(), reasoning.verdict.clone()]);
        }
        rows.extend(
            reasoning
                .rationale
                .iter()
                .map(|point| vec!["Rationale".into(), point.clone()]),
        );
        sheets.push(SpreadsheetSheet {
            name: "Decision Record".into(),
            headers: vec!["Type".into(), "Detail".into()],
            rows,
        });
    }
    let names = unique_sheet_names(&sheets);
    let mut zip = zip::ZipWriter::new(&mut file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut write = |name: &str, value: &str| -> Result<(), String> {
        zip.start_file(name, options)
            .map_err(|error| format!("Could not create XLSX entry {name}: {error}"))?;
        zip.write_all(value.as_bytes())
            .map_err(|error| format!("Could not write XLSX entry {name}: {error}"))
    };
    write("[Content_Types].xml", &xlsx_content_types(sheets.len()))?;
    write("_rels/.rels", XLSX_ROOT_RELS)?;
    write("xl/workbook.xml", &workbook_xml(&names))?;
    write(
        "xl/_rels/workbook.xml.rels",
        &workbook_rels_xml(sheets.len()),
    )?;
    write("xl/styles.xml", XLSX_STYLES)?;
    for (index, sheet) in sheets.iter().enumerate() {
        write(
            &format!("xl/worksheets/sheet{}.xml", index + 1),
            &worksheet_xml(sheet, &spec.title, &spec.subtitle),
        )?;
    }
    zip.finish()
        .map_err(|error| format!("Could not finalize XLSX: {error}"))?;
    Ok(())
}

pub fn generate_xlsx(spec: &SpreadsheetSpec) -> Result<GeneratedFile, String> {
    generate_xlsx_in_dir(spec, &output_dir())
}

fn generate_xlsx_in_dir(spec: &SpreadsheetSpec, directory: &Path) -> Result<GeneratedFile, String> {
    validate_spreadsheet_spec(spec)?;
    let metadata = std::fs::symlink_metadata(directory)
        .map_err(|error| format!("Could not inspect workbook output directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Workbook output must be a real, non-symlink directory".into());
    }
    let stem = safe_stem(&spec.title, "workbook");
    let (path, file) = create_unique_file_in_dir(directory, &stem, "xlsx")?;
    write_xlsx(file, spec)?;
    Ok(GeneratedFile {
        filename: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: path.to_string_lossy().to_string(),
        kind: "xlsx".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn safe_stem_sanitizes() {
        assert_eq!(safe_stem("My Report: 2026!", "x"), "My-Report-2026");
        assert_eq!(safe_stem("   ", "fallback"), "fallback");
    }

    #[test]
    fn xml_escape_handles_specials() {
        assert_eq!(xml_escape("a & b < c > d"), "a &amp; b &lt; c &gt; d");
    }

    #[test]
    fn unique_reservation_never_overwrites_an_existing_output() {
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("report.docx");
        std::fs::write(&original, b"keep this").unwrap();

        let (reserved, _file) =
            create_unique_file_in_dir(directory.path(), "report", "docx").unwrap();

        assert_eq!(reserved.file_name().unwrap(), "report-2.docx");
        assert_eq!(std::fs::read(&original).unwrap(), b"keep this");
    }

    #[test]
    fn docx_generates_file() {
        let spec = WordSpec {
            title: "Test Doc".into(),
            subtitle: "A subtitle".into(),
            sections: vec![WordSection {
                heading: "Intro".into(),
                paragraphs: vec!["Hello world.".into()],
                bullets: vec!["Point one".into(), "Point two".into()],
            }],
            reasoning: None,
        };
        let out = generate_docx(&spec).expect("docx generation");
        assert!(out.path.ends_with(".docx"));
        let meta = std::fs::metadata(&out.path).expect("file exists");
        assert!(meta.len() > 0);
        let _ = std::fs::remove_file(&out.path);
    }

    #[test]
    fn pptx_generates_file() {
        let spec = DeckSpec {
            title: "Deck".into(),
            subtitle: "Sub".into(),
            slides: vec![
                SlideSpec {
                    title: "Slide 1".into(),
                    bullets: vec!["A".into(), "B".into()],
                    notes: String::new(),
                },
                SlideSpec {
                    title: "Slide 2".into(),
                    bullets: vec!["C".into()],
                    notes: String::new(),
                },
            ],
            reasoning: None,
        };
        let out = generate_pptx(&spec).expect("pptx generation");
        assert!(out.path.ends_with(".pptx"));
        let meta = std::fs::metadata(&out.path).expect("file exists");
        assert!(meta.len() > 0);
        let _ = std::fs::remove_file(&out.path);
    }

    #[test]
    fn pdf_generates_a_valid_bounded_file() {
        let directory = tempfile::tempdir().unwrap();
        let spec = WordSpec {
            title: "Executive Upgrade Plan".into(),
            subtitle: "Verification-first".into(),
            sections: vec![WordSection {
                heading: "Scope".into(),
                paragraphs: vec!["DEV to Test to Stage to Prod".into()],
                bullets: vec!["Verify official sources".into()],
            }],
            reasoning: None,
        };
        let out = generate_pdf_in_dir(&spec, directory.path()).expect("PDF generation");
        let bytes = std::fs::read(&out.path).expect("read PDF");
        assert!(bytes.starts_with(b"%PDF-1.4"));
        assert!(bytes.ends_with(b"%%EOF\n"));
        assert!(String::from_utf8_lossy(&bytes).contains("Executive Upgrade Plan"));
        assert_eq!(out.kind, "pdf");
    }

    #[test]
    fn xlsx_generates_string_only_workbook() {
        let directory = tempfile::tempdir().unwrap();
        let spec = SpreadsheetSpec {
            title: "Landscape Tracker".into(),
            subtitle: "DEV to Prod".into(),
            sheets: vec![SpreadsheetSheet {
                name: "Landscape Plan".into(),
                headers: vec!["Landscape".into(), "Status".into()],
                rows: vec![vec!["DEV".into(), "=2+2".into()]],
            }],
            reasoning: None,
        };
        let out = generate_xlsx_in_dir(&spec, directory.path()).expect("XLSX generation");
        let file = std::fs::File::open(&out.path).expect("open XLSX");
        let mut archive = zip::ZipArchive::new(file).expect("valid XLSX zip");
        let mut worksheet = String::new();
        archive
            .by_name("xl/worksheets/sheet1.xml")
            .expect("worksheet XML")
            .read_to_string(&mut worksheet)
            .expect("read worksheet XML");
        assert!(worksheet.contains("Landscape Tracker"));
        assert!(worksheet.contains("=2+2"));
        assert!(!worksheet.contains("<f>"));
        assert!(worksheet.contains("t=\"inlineStr\""));
        assert_eq!(out.kind, "xlsx");
    }

    #[test]
    fn decision_record_renders_but_legacy_hidden_reasoning_does_not() {
        // The backend accepts the structured appendix the frontend sends while
        // ignoring the legacy hidden-reasoning field.
        let json = r#"{
            "title":"Report","subtitle":"S",
            "sections":[{"heading":"H","paragraphs":["p"],"bullets":[]}],
            "reasoning":{"rationale":["Chose 3 sections for clarity"],"thinking":"Weighed depth vs length.","verdict":"Judge accepted (90%)"}
        }"#;
        let spec: WordSpec = serde_json::from_str(json).expect("spec parses");
        let r = spec.reasoning.as_ref().expect("reasoning present");
        assert!(!r.is_empty());
        assert_eq!(r.rationale.len(), 1);
        assert_eq!(r.verdict, "Judge accepted (90%)");
        let out = generate_docx(&spec).expect("docx with reasoning");
        assert!(std::fs::metadata(&out.path).expect("exists").len() > 0);
        {
            let file = std::fs::File::open(&out.path).expect("open docx");
            let mut archive = zip::ZipArchive::new(file).expect("valid docx zip");
            let mut xml = String::new();
            archive
                .by_name("word/document.xml")
                .expect("document XML")
                .read_to_string(&mut xml)
                .expect("read document XML");
            assert!(xml.contains("Decision Record"));
            assert!(xml.contains("Chose 3 sections for clarity"));
            assert!(xml.contains("Judge accepted (90%)"));
            assert!(!xml.contains("Weighed depth vs length"));
        }
        let _ = std::fs::remove_file(&out.path);
    }

    #[test]
    fn empty_reasoning_is_treated_as_absent() {
        let empty = ReasoningAppendix::default();
        assert!(empty.is_empty());
        // A spec with no reasoning field parses to None.
        let spec: WordSpec = serde_json::from_str(r#"{"title":"T"}"#).unwrap();
        assert!(spec.reasoning.is_none());
    }
}
