// Document Generator — Local Word (.docx) + PowerPoint (.pptx) creation
//
// When the user asks the local chatbot to "create a Word document" or "make a
// PowerPoint", the LLM produces a structured JSON spec (title + sections/slides)
// and this module turns it into a real Office Open XML file on disk. Everything
// happens on-device — no network, no cloud export — preserving the offline
// invariant. Files are written to the user's Downloads folder.
//
// - .docx is built with the `docx-rs` crate.
// - .pptx is assembled directly as an Office Open XML package (a zip of XML
//   parts) since there is no mature local pptx-writer crate. The package is a
//   minimal-but-valid deck that PowerPoint, Keynote and LibreOffice all open.

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WordSpec {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub sections: Vec<WordSection>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SlideSpec {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub bullets: Vec<String>,
    #[serde(default)]
    pub notes: String,
    /// Layout selector: "" / "bullets" (default), "section", "two_column",
    /// "big_fact", "quote". Unknown values fall back to bullets — old specs
    /// keep working unchanged.
    #[serde(default)]
    pub layout: String,
    /// two_column layout: optional column headers + per-column bullets.
    #[serde(default)]
    pub left_title: String,
    #[serde(default)]
    pub right_title: String,
    #[serde(default)]
    pub left: Vec<String>,
    #[serde(default)]
    pub right: Vec<String>,
    /// big_fact layout: the one number/phrase that carries the slide, plus a
    /// one-line caption under it.
    #[serde(default)]
    pub fact: String,
    #[serde(default)]
    pub caption: String,
    /// quote layout.
    #[serde(default)]
    pub quote: String,
    #[serde(default)]
    pub attribution: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckSpec {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub slides: Vec<SlideSpec>,
}

/// Result returned to the frontend after a file is written.
#[derive(Debug, Clone, Serialize)]
pub struct GeneratedFile {
    pub path: String,
    pub filename: String,
    pub kind: String, // "docx" | "pptx"
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

/// Split a bullet like "Speed: 36 tok/s on an M-series MacBook" into a short
/// lead-in (kept bold) and the rest. Only fires on a compact lead followed by
/// ": ", " — " or " – " — long or sentence-like leads stay unstyled. This is
/// what turns a wall of uniform bullets into scannable label → detail lines.
fn split_lead(text: &str) -> Option<(String, String)> {
    for sep in [": ", " — ", " – "] {
        if let Some(pos) = text.find(sep) {
            let lead = &text[..pos];
            let rest = &text[pos + sep.len()..];
            if !lead.is_empty()
                && lead.chars().count() <= 42
                && !lead.contains('.')
                && !rest.trim().is_empty()
            {
                return Some((
                    format!("{lead}{}", sep.trim_end()),
                    rest.trim_start().to_string(),
                ));
            }
        }
    }
    None
}

/// One bulleted paragraph with the shared indent/spacing/marker style, bold
/// lead-in when the text carries one, at the given font size (OOXML hundredths
/// of a point).
fn bullet_para(text: &str, size: u32) -> String {
    let runs = match split_lead(text) {
        Some((lead, rest)) => format!(
            r#"<a:r><a:rPr lang="en-US" sz="{size}" b="1" dirty="0"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>{} </a:t></a:r><a:r><a:rPr lang="en-US" sz="{size}" dirty="0"><a:solidFill><a:srgbClr val="334155"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>{}</a:t></a:r>"#,
            xml_escape(&lead),
            xml_escape(&rest)
        ),
        None => format!(
            r#"<a:r><a:rPr lang="en-US" sz="{size}" dirty="0"><a:solidFill><a:srgbClr val="334155"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>{}</a:t></a:r>"#,
            xml_escape(text)
        ),
    };
    format!(
        r#"<a:p><a:pPr marL="342900" indent="-342900"><a:lnSpc><a:spcPct val="130000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buClr><a:srgbClr val="6366F1"/></a:buClr><a:buSzPct val="80000"/><a:buFont typeface="Arial"/><a:buChar char="&#9642;"/></a:pPr>{runs}</a:p>"#
    )
}

/// Turn a document title into a safe file stem (no path separators / weird chars).
pub(crate) fn safe_stem(title: &str, fallback: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join("-");
    let trimmed = collapsed.trim_matches('-');
    let stem = if trimmed.is_empty() { fallback } else { trimmed };
    // Keep filenames reasonable
    stem.chars().take(60).collect()
}

/// Resolve the output directory, preferring Downloads, then Desktop, then home.
pub(crate) fn output_dir() -> PathBuf {
    dirs::download_dir()
        .or_else(dirs::desktop_dir)
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Build a unique, non-clobbering path in the output dir for `<stem>.<ext>`.
fn unique_path(stem: &str, ext: &str) -> PathBuf {
    let dir = output_dir();
    let mut candidate = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{n}.{ext}"));
        n += 1;
    }
    candidate
}

// ─── Generic text files (.html / .md / .txt / .csv / .json / .svg) ───────────

/// Extensions create_text_file may write. Plain renderable/text formats only —
/// never executables or scripts.
const TEXT_EXTS: &[&str] = &["html", "md", "txt", "csv", "json", "svg"];

/// Write a plain-text file (HTML page, Markdown note, CSV, …) to the output
/// dir. Same non-clobbering, Downloads-first behavior as docx/pptx generation.
pub fn generate_text_file(title: &str, ext: &str, content: &str) -> Result<GeneratedFile, String> {
    let ext = ext.trim_start_matches('.').to_lowercase();
    if !TEXT_EXTS.contains(&ext.as_str()) {
        return Err(format!(
            "Unsupported file type '.{ext}'. Supported: html, md, txt, csv, json, svg."
        ));
    }
    if content.trim().is_empty() {
        return Err("Refusing to write an empty file.".to_string());
    }
    let stem = safe_stem(title, "generated-file");
    let path = unique_path(&stem, &ext);
    std::fs::write(&path, content).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(GeneratedFile {
        path: path.to_string_lossy().to_string(),
        filename: path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| format!("{stem}.{ext}")),
        kind: ext,
    })
}

// ─── Word (.docx) ────────────────────────────────────────────────────────────

/// Generate a Word document from a spec. Returns the written file's metadata.
pub fn generate_docx(spec: &WordSpec) -> Result<GeneratedFile, String> {
    use docx_rs::*;

    let mut docx = Docx::new();

    // Title (centered, large, bold, dark slate)
    if !spec.title.trim().is_empty() {
        docx = docx.add_paragraph(
            Paragraph::new()
                .align(AlignmentType::Center)
                .add_run(Run::new().add_text(&spec.title).bold().size(56).color("0F172A")),
        );
    }

    // Subtitle (centered, medium, accent color)
    if !spec.subtitle.trim().is_empty() {
        docx = docx.add_paragraph(
            Paragraph::new()
                .align(AlignmentType::Center)
                .add_run(Run::new().add_text(&spec.subtitle).italic().size(28).color("6366F1")),
        );
    }

    // Spacer after the title block
    if !spec.title.trim().is_empty() || !spec.subtitle.trim().is_empty() {
        docx = docx.add_paragraph(Paragraph::new());
    }

    for section in &spec.sections {
        if !section.heading.trim().is_empty() {
            docx = docx.add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text(&section.heading).bold().size(32).color("4F46E5")),
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
            // Bold lead-in ("Label: detail") when the bullet carries one.
            let para = match split_lead(bullet) {
                Some((lead, rest)) => Paragraph::new()
                    .add_run(Run::new().add_text(format!("▪  {lead} ")).bold().size(24).color("0F172A"))
                    .add_run(Run::new().add_text(rest).size(24).color("334155")),
                None => Paragraph::new()
                    .add_run(Run::new().add_text(format!("▪  {bullet}")).size(24).color("334155")),
            };
            docx = docx.add_paragraph(para);
        }
        // Blank line between sections
        docx = docx.add_paragraph(Paragraph::new());
    }

    let stem = safe_stem(&spec.title, "document");
    let path = unique_path(&stem, "docx");

    let file = std::fs::File::create(&path)
        .map_err(|e| format!("Failed to create docx file: {e}"))?;
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
    // Assemble the slide list: an optional title slide followed by content slides.
    let mut slides: Vec<RenderSlide> = Vec::new();
    if !spec.title.trim().is_empty() {
        slides.push(RenderSlide {
            subtitle: spec.subtitle.clone(),
            is_title: true,
            spec: SlideSpec {
                title: spec.title.clone(),
                ..Default::default()
            },
        });
    }
    for s in &spec.slides {
        slides.push(RenderSlide {
            subtitle: String::new(),
            is_title: false,
            spec: s.clone(),
        });
    }
    if slides.is_empty() {
        return Err("Presentation has no slides".to_string());
    }

    let stem = safe_stem(&spec.title, "presentation");
    let path = unique_path(&stem, "pptx");

    write_pptx(&path, &slides)?;

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
    subtitle: String,
    is_title: bool,
    spec: SlideSpec,
}

/// Write the full OOXML presentation package to `path`.
fn write_pptx(path: &Path, slides: &[RenderSlide]) -> Result<(), String> {
    use zip::write::SimpleFileOptions;

    let file = std::fs::File::create(path)
        .map_err(|e| format!("Failed to create pptx file: {e}"))?;
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
    // Slides carrying speaker notes each get a notesSlide part. The notes
    // infrastructure (notesMaster + its theme) is only emitted when at least
    // one slide has notes, so note-free decks stay byte-identical in shape.
    let has_notes: Vec<bool> = slides.iter().map(|s| !s.spec.notes.trim().is_empty()).collect();
    let any_notes = has_notes.iter().any(|b| *b);

    write("[Content_Types].xml", &content_types_xml(n, &has_notes))?;
    write("_rels/.rels", ROOT_RELS)?;
    write("ppt/presentation.xml", &presentation_xml(n, any_notes))?;
    write(
        "ppt/_rels/presentation.xml.rels",
        &presentation_rels_xml(n, any_notes),
    )?;
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
    if any_notes {
        write("ppt/theme/theme2.xml", &THEME1.replace("Office Theme", "Notes Theme"))?;
        write("ppt/notesMasters/notesMaster1.xml", NOTES_MASTER)?;
        write(
            "ppt/notesMasters/_rels/notesMaster1.xml.rels",
            NOTES_MASTER_RELS,
        )?;
    }

    let total = slides.len();
    for (i, slide) in slides.iter().enumerate() {
        let idx = i + 1;
        write(&format!("ppt/slides/slide{idx}.xml"), &slide_xml(slide, idx, total))?;
        write(
            &format!("ppt/slides/_rels/slide{idx}.xml.rels"),
            &slide_rels_xml(has_notes[i], idx),
        )?;
        if has_notes[i] {
            write(
                &format!("ppt/notesSlides/notesSlide{idx}.xml"),
                &notes_slide_xml(&slide.spec.notes),
            )?;
            write(
                &format!("ppt/notesSlides/_rels/notesSlide{idx}.xml.rels"),
                &notes_slide_rels_xml(idx),
            )?;
        }
    }

    zip.finish().map_err(|e| format!("zip finish: {e}"))?;
    Ok(())
}

/// Per-slide relationships: always the layout; plus the notes slide when the
/// slide carries speaker notes.
fn slide_rels_xml(has_notes: bool, idx: usize) -> String {
    let notes_rel = if has_notes {
        format!(
            r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide{idx}.xml"/>"#
        )
    } else {
        String::new()
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>{notes_rel}</Relationships>"#
    )
}

/// A speaker-notes page: the body placeholder with one paragraph per line of
/// the spec's notes text.
fn notes_slide_xml(notes: &str) -> String {
    let mut paras = String::new();
    for line in notes.lines().filter(|l| !l.trim().is_empty()) {
        paras.push_str(&format!(
            r#"<a:p><a:r><a:rPr lang="en-US" sz="1200" dirty="0"/><a:t>{}</a:t></a:r></a:p>"#,
            xml_escape(line.trim())
        ));
    }
    if paras.is_empty() {
        paras.push_str(r#"<a:p><a:endParaRPr lang="en-US"/></a:p>"#);
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld>
<p:spTree>
{SPTREE_HEAD}
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>
{paras}
</p:txBody>
</p:sp>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:notes>"#
    )
}

fn notes_slide_rels_xml(idx: usize) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide{idx}.xml"/>
</Relationships>"#
    )
}

fn content_types_xml(slide_count: usize, has_notes: &[bool]) -> String {
    let mut overrides = String::new();
    for i in 1..=slide_count {
        overrides.push_str(&format!(
            "<Override PartName=\"/ppt/slides/slide{i}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>"
        ));
    }
    let any_notes = has_notes.iter().any(|b| *b);
    if any_notes {
        overrides.push_str("<Override PartName=\"/ppt/notesMasters/notesMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml\"/>");
        overrides.push_str("<Override PartName=\"/ppt/theme/theme2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>");
        for (i, has) in has_notes.iter().enumerate() {
            if *has {
                let idx = i + 1;
                overrides.push_str(&format!(
                    "<Override PartName=\"/ppt/notesSlides/notesSlide{idx}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml\"/>"
                ));
            }
        }
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

fn presentation_xml(slide_count: usize, any_notes: bool) -> String {
    let mut sld_ids = String::new();
    for i in 0..slide_count {
        // r:id for slides starts at rId2 (rId1 is the slide master)
        let rid = i + 2;
        let sld_id = 256 + i;
        sld_ids.push_str(&format!("<p:sldId id=\"{sld_id}\" r:id=\"rId{rid}\"/>"));
    }
    // Schema order matters: notesMasterIdLst sits between sldMasterIdLst and
    // sldIdLst. Its r:id is allocated after theme + presProps.
    let notes_master_lst = if any_notes {
        let rid = slide_count + 4;
        format!("<p:notesMasterIdLst><p:notesMasterId r:id=\"rId{rid}\"/></p:notesMasterIdLst>")
    } else {
        String::new()
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
{notes_master_lst}<p:sldIdLst>{sld_ids}</p:sldIdLst>
<p:sldSz cx="12192000" cy="6858000"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>"#
    )
}

fn presentation_rels_xml(slide_count: usize, any_notes: bool) -> String {
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
    if any_notes {
        let nm_rid = slide_count + 4;
        rels.push_str(&format!(
            r#"<Relationship Id="rId{nm_rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>"#
        ));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>"#
    )
}

/// Route a slide to its layout. Unknown layout strings fall back to the
/// bullets layout so older specs (and model improvisation) degrade gracefully.
fn slide_xml(slide: &RenderSlide, index: usize, total: usize) -> String {
    if slide.is_title {
        return title_slide_xml(slide);
    }
    match slide.spec.layout.trim() {
        "section" => section_slide_xml(&slide.spec),
        "two_column" => two_column_slide_xml(&slide.spec, index, total),
        "big_fact" => big_fact_slide_xml(&slide.spec, index, total),
        "quote" => quote_slide_xml(&slide.spec, index, total),
        _ => content_slide_xml(slide, index, total),
    }
}

/// Shared footer: hairline rule + "index / total" page marker.
fn footer_shapes(index: usize, total: usize) -> String {
    format!(
        r#"<p:sp>
<p:nvSpPr><p:cNvPr id="20" name="FooterLine"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="6416040"/><a:ext cx="10820400" cy="12700"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="21" name="PageNum"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="10287000" y="6479540"/><a:ext cx="1219200" cy="304800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:pPr algn="r"/><a:r><a:rPr lang="en-US" sz="1100" dirty="0"><a:solidFill><a:srgbClr val="94A3B8"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>{index} / {total}</a:t></a:r></a:p>
</p:txBody>
</p:sp>"#
    )
}

/// Shared white-canvas chrome: left gradient sidebar, dark bold title with an
/// accent underline. Body content is supplied by the caller.
fn white_slide_shell(title: &str, body_shapes: &str, index: usize, total: usize) -> String {
    let title = xml_escape(title);
    let footer = footer_shapes(index, total);
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
<p:txBody><a:bodyPr anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>
<a:p><a:r><a:rPr lang="en-US" sz="3600" b="1" dirty="0"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>{title}</a:t></a:r></a:p>
</p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="4" name="Underline"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="693420" y="1508760"/><a:ext cx="1188720" cy="51435"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="6366F1"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>
{body_shapes}
{footer}
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"#
    )
}

/// Section divider: full-bleed gradient, small kicker, huge centered title.
/// Bullets (if any) become a single sub-line under the title.
fn section_slide_xml(spec: &SlideSpec) -> String {
    let title = xml_escape(&spec.title);
    let subline = spec
        .bullets
        .iter()
        .find(|b| !b.trim().is_empty())
        .map(|b| {
            format!(
                r#"<p:sp>
<p:nvSpPr><p:cNvPr id="4" name="SubLine"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="1219200" y="4038600"/><a:ext cx="9753600" cy="685800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="2000" dirty="0"><a:solidFill><a:srgbClr val="E0E7FF"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>{}</a:t></a:r></a:p>
</p:txBody>
</p:sp>"#,
                xml_escape(b)
            )
        })
        .unwrap_or_default();
    format!(
        r#"{SLD_OPEN}
<p:cSld>
<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="4F46E5"/></a:gs><a:gs pos="100000"><a:srgbClr val="7C3AED"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="1"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree>
{SPTREE_HEAD}
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="Kicker"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="1219200" y="2286000"/><a:ext cx="9753600" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1400" b="1" spc="300" dirty="0"><a:solidFill><a:srgbClr val="C7D2FE"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>SECTION</a:t></a:r></a:p>
</p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="3" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="914400" y="2743200"/><a:ext cx="10363200" cy="1219200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="4800" b="1" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>{title}</a:t></a:r></a:p>
</p:txBody>
</p:sp>
{subline}
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"#
    )
}

/// Two-column comparison: shared shell + two bullet columns with optional
/// accent column headers.
fn two_column_slide_xml(spec: &SlideSpec, index: usize, total: usize) -> String {
    let col = |x: i64, header: &str, items: &[String], id: u32| -> String {
        let mut paras = String::new();
        if !header.trim().is_empty() {
            paras.push_str(&format!(
                r#"<a:p><a:r><a:rPr lang="en-US" sz="2000" b="1" dirty="0"><a:solidFill><a:srgbClr val="4F46E5"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>{}</a:t></a:r></a:p>"#,
                xml_escape(header)
            ));
        }
        for item in items {
            if item.trim().is_empty() {
                continue;
            }
            paras.push_str(&bullet_para(item, 1800));
        }
        if paras.is_empty() {
            paras.push_str(r#"<a:p><a:endParaRPr lang="en-US"/></a:p>"#);
        }
        format!(
            r#"<p:sp>
<p:nvSpPr><p:cNvPr id="{id}" name="Column"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="{x}" y="1783080"/><a:ext cx="5219700" cy="4419600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>
{paras}
</p:txBody>
</p:sp>"#
        )
    };
    let body = format!(
        "{}{}",
        col(685800, &spec.left_title, &spec.left, 5),
        col(6286500, &spec.right_title, &spec.right, 6)
    );
    white_slide_shell(&spec.title, &body, index, total)
}

/// Big-fact slide: one huge accent number/phrase with a caption under it.
fn big_fact_slide_xml(spec: &SlideSpec, index: usize, total: usize) -> String {
    let fact = xml_escape(if spec.fact.trim().is_empty() { "—" } else { &spec.fact });
    let caption = xml_escape(&spec.caption);
    let body = format!(
        r#"<p:sp>
<p:nvSpPr><p:cNvPr id="5" name="Fact"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="2286000"/><a:ext cx="10820400" cy="2286000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="9600" b="1" dirty="0"><a:solidFill><a:srgbClr val="4F46E5"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>{fact}</a:t></a:r></a:p>
</p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="6" name="Caption"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="1219200" y="4724400"/><a:ext cx="9753600" cy="762000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="2000" dirty="0"><a:solidFill><a:srgbClr val="334155"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>{caption}</a:t></a:r></a:p>
</p:txBody>
</p:sp>"#
    );
    white_slide_shell(&spec.title, &body, index, total)
}

/// Quote slide: soft background, oversized decorative quote mark, the quote
/// in large italics, and an accent attribution line.
fn quote_slide_xml(spec: &SlideSpec, index: usize, total: usize) -> String {
    let quote = xml_escape(if spec.quote.trim().is_empty() { &spec.title } else { &spec.quote });
    let attribution = if spec.attribution.trim().is_empty() {
        String::new()
    } else {
        format!(
            r#"<p:sp>
<p:nvSpPr><p:cNvPr id="6" name="Attribution"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="1524000" y="4876800"/><a:ext cx="9144000" cy="533400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1800" b="1" dirty="0"><a:solidFill><a:srgbClr val="4F46E5"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>— {}</a:t></a:r></a:p>
</p:txBody>
</p:sp>"#,
            xml_escape(&spec.attribution)
        )
    };
    let footer = footer_shapes(index, total);
    format!(
        r#"{SLD_OPEN}
<p:cSld>
<p:bg><p:bgPr><a:solidFill><a:srgbClr val="F8FAFC"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree>
{SPTREE_HEAD}
<p:sp>
<p:nvSpPr><p:cNvPr id="2" name="QuoteMark"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="990600" y="990600"/><a:ext cx="1524000" cy="1524000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:r><a:rPr lang="en-US" sz="14400" b="1" dirty="0"><a:solidFill><a:srgbClr val="C7D2FE"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>&#8220;</a:t></a:r></a:p>
</p:txBody>
</p:sp>
<p:sp>
<p:nvSpPr><p:cNvPr id="5" name="Quote"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="1524000" y="2133600"/><a:ext cx="9144000" cy="2590800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="3200" i="1" dirty="0"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill><a:latin typeface="+mj-lt"/></a:rPr><a:t>{quote}</a:t></a:r></a:p>
</p:txBody>
</p:sp>
{attribution}
{footer}
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"#
    )
}

const SLD_OPEN: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">"#;

const SPTREE_HEAD: &str = r#"<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>"#;

/// Hero title slide: full-bleed indigo→violet gradient, accent bar, big title,
/// subtitle, and a subtle local-privacy footer.
fn title_slide_xml(slide: &RenderSlide) -> String {
    let title = xml_escape(&slide.spec.title);

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
<a:p><a:r><a:rPr lang="en-US" sz="1100" dirty="0"><a:solidFill><a:srgbClr val="C7D2FE"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>Generated locally with PrismOS-AI · 100% private</a:t></a:r></a:p>
</p:txBody>
</p:sp>
</p:spTree>
</p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>"#
    )
}

/// Content slide: shared white shell + auto-fitting bullet body with bold
/// lead-ins.
fn content_slide_xml(slide: &RenderSlide, index: usize, total: usize) -> String {
    let mut body_paras = String::new();
    for bullet in &slide.spec.bullets {
        if bullet.trim().is_empty() {
            continue;
        }
        body_paras.push_str(&bullet_para(bullet, 2000));
    }
    if body_paras.is_empty() {
        body_paras.push_str(r#"<a:p><a:endParaRPr lang="en-US"/></a:p>"#);
    }
    let body = format!(
        r#"<p:sp>
<p:nvSpPr><p:cNvPr id="5" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="1783080"/><a:ext cx="10820400" cy="4419600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr><a:normAutofit/></a:bodyPr><a:lstStyle/>
{body_paras}
</p:txBody>
</p:sp>"#
    );
    white_slide_shell(&slide.spec.title, &body, index, total)
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

const NOTES_MASTER: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld>
<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>
<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree>
</p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:notesStyle>
<a:lvl1pPr><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>
</p:notesStyle>
</p:notesMaster>"#;

const NOTES_MASTER_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme2.xml"/>
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn docx_generates_file() {
        let spec = WordSpec {
            title: "Test Doc".into(),
            subtitle: "A subtitle".into(),
            sections: vec![WordSection {
                heading: "Intro".into(),
                paragraphs: vec!["Hello world.".into()],
                bullets: vec!["Point one".into(), "Point two".into()],
            }],
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
                SlideSpec { title: "Slide 1".into(), bullets: vec!["A".into(), "B".into()], ..Default::default() },
                SlideSpec { title: "Slide 2".into(), bullets: vec!["C".into()], ..Default::default() },
            ],
        };
        let out = generate_pptx(&spec).expect("pptx generation");
        assert!(out.path.ends_with(".pptx"));
        let meta = std::fs::metadata(&out.path).expect("file exists");
        assert!(meta.len() > 0);
        let _ = std::fs::remove_file(&out.path);
    }

    #[test]
    fn split_lead_detects_compact_labels_only() {
        assert_eq!(
            split_lead("Speed: 36 tok/s on an M-series MacBook"),
            Some(("Speed:".to_string(), "36 tok/s on an M-series MacBook".to_string()))
        );
        assert_eq!(
            split_lead("Privacy — nothing leaves the machine"),
            Some(("Privacy —".to_string(), "nothing leaves the machine".to_string()))
        );
        // A full sentence before the colon must NOT become a lead-in.
        assert_eq!(split_lead("This is a long sentence. It mentions: something"), None);
        assert_eq!(split_lead("No separator here at all"), None);
    }

    #[test]
    fn pptx_layouts_and_notes_roundtrip() {
        let spec = DeckSpec {
            title: "Layout Deck".into(),
            subtitle: "All five layouts".into(),
            slides: vec![
                SlideSpec { title: "Chapter One".into(), layout: "section".into(), bullets: vec!["What this chapter covers".into()], ..Default::default() },
                SlideSpec {
                    title: "Bullets".into(),
                    bullets: vec!["Speed: very fast".into(), "plain bullet".into()],
                    notes: "Say hello.\nMention speed.".into(),
                    ..Default::default()
                },
                SlideSpec {
                    title: "Compare".into(),
                    layout: "two_column".into(),
                    left_title: "Pros".into(),
                    right_title: "Cons".into(),
                    left: vec!["local".into()],
                    right: vec!["big download".into()],
                    ..Default::default()
                },
                SlideSpec { title: "The number".into(), layout: "big_fact".into(), fact: "36.2".into(), caption: "tokens per second".into(), ..Default::default() },
                SlideSpec { title: "Quote".into(), layout: "quote".into(), quote: "It just works".into(), attribution: "A user".into(), ..Default::default() },
            ],
        };
        let out = generate_pptx(&spec).expect("pptx generation");

        // Re-open the package and verify structure: notes parts exist for the
        // one slide that has notes (slide index 3 = title slide + 2), the
        // notes master is registered, and autofit made it into the slide XML.
        let file = std::fs::File::open(&out.path).expect("open pptx");
        let mut zip = zip::ZipArchive::new(file).expect("read zip");
        let names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect();
        assert!(names.iter().any(|n| n == "ppt/notesSlides/notesSlide3.xml"), "notes slide part missing: {names:?}");
        assert!(names.iter().any(|n| n == "ppt/notesMasters/notesMaster1.xml"));
        assert!(names.iter().any(|n| n == "ppt/theme/theme2.xml"));

        let read = |zip: &mut zip::ZipArchive<std::fs::File>, name: &str| -> String {
            use std::io::Read;
            let mut s = String::new();
            zip.by_name(name).unwrap().read_to_string(&mut s).unwrap();
            s
        };
        let pres = read(&mut zip, "ppt/presentation.xml");
        assert!(pres.contains("notesMasterIdLst"));
        let content = read(&mut zip, "ppt/slides/slide3.xml");
        assert!(content.contains("normAutofit"), "autofit missing from content slide");
        assert!(content.contains("<a:t>Speed:</a:t>") || content.contains("Speed:"), "bold lead-in missing");
        assert!(content.contains("3 / 6"), "page marker missing");
        let notes = read(&mut zip, "ppt/notesSlides/notesSlide3.xml");
        assert!(notes.contains("Say hello."));
        assert!(notes.contains("Mention speed."));
        let section = read(&mut zip, "ppt/slides/slide2.xml");
        assert!(section.contains("SECTION"));
        let fact = read(&mut zip, "ppt/slides/slide5.xml");
        assert!(fact.contains("36.2"));
        let quote = read(&mut zip, "ppt/slides/slide6.xml");
        assert!(quote.contains("It just works"));

        let _ = std::fs::remove_file(&out.path);
    }

    #[test]
    fn pptx_without_notes_has_no_notes_parts() {
        let spec = DeckSpec {
            title: "Plain".into(),
            subtitle: String::new(),
            slides: vec![SlideSpec { title: "S".into(), bullets: vec!["a".into()], ..Default::default() }],
        };
        let out = generate_pptx(&spec).expect("pptx generation");
        let file = std::fs::File::open(&out.path).expect("open pptx");
        let mut zip = zip::ZipArchive::new(file).expect("read zip");
        let names: Vec<String> = (0..zip.len())
            .map(|i| zip.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(!names.iter().any(|n| n.contains("notesSlide")), "unexpected notes parts: {names:?}");
        assert!(!names.iter().any(|n| n.contains("notesMaster")));
        let _ = std::fs::remove_file(&out.path);
    }
}
