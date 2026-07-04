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

/// Turn a document title into a safe file stem (no path separators / weird chars).
fn safe_stem(title: &str, fallback: &str) -> String {
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
fn output_dir() -> PathBuf {
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
            docx = docx.add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_text(format!("▪  {bullet}")).size(24).color("334155")),
            );
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
    title: String,
    subtitle: String,
    bullets: Vec<String>,
    is_title: bool,
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
        write(&format!("ppt/slides/slide{idx}.xml"), &slide_xml(slide, idx, total))?;
        write(
            &format!("ppt/slides/_rels/slide{idx}.xml.rels"),
            SLIDE_RELS,
        )?;
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
<a:p><a:r><a:rPr lang="en-US" sz="1100" dirty="0"><a:solidFill><a:srgbClr val="C7D2FE"/></a:solidFill><a:latin typeface="+mn-lt"/></a:rPr><a:t>Generated locally with PrismOS-AI · 100% private</a:t></a:r></a:p>
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
                SlideSpec { title: "Slide 1".into(), bullets: vec!["A".into(), "B".into()], notes: String::new() },
                SlideSpec { title: "Slide 2".into(), bullets: vec!["C".into()], notes: String::new() },
            ],
        };
        let out = generate_pptx(&spec).expect("pptx generation");
        assert!(out.path.ends_with(".pptx"));
        let meta = std::fs::metadata(&out.path).expect("file exists");
        assert!(meta.len() > 0);
        let _ = std::fs::remove_file(&out.path);
    }
}
