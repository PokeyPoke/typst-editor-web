/**
 * Document templates — definitions and source generators.
 * Loaded as a classic script; exports global `Templates`.
 */

const Templates = (() => {

  // ── Shared helper definitions ──────────────────────

  function helperDefs(primary) {
    return `// ── Colours ──────────────────────────────────────────
#let primary = rgb("${primary}")
#let muted   = rgb("#4b5a6a")
#let tint    = rgb("#eaf4fc")
#let tint2   = rgb("#f4f9fe")
#let lc      = rgb("#cfe2f3")
#let ink     = rgb("#1e2430")
#let warn-bg = rgb("#fff7ec")
#let warn-c  = rgb("#d4760a")
#let ok-bg   = rgb("#eef8f2")
#let ok-c    = rgb("#1a8a4a")
#let dng-bg  = rgb("#fef2f2")
#let dng-c   = rgb("#c0392b")

// ── Style variables (edit in Document Settings) ──────
#let card-stroke-top  = 5pt
#let card-stroke-rest = 1.5pt
#let card-inset       = 6mm
#let card-radius      = 4pt
#let image-radius     = 0pt
#let title-bar-w      = 42mm

// ── Footer state ─────────────────────────────────────
#let fsec          = state("fsec", "")
#let footer-center = ""

// ── Helper: numbered circle badge ────────────────────
#let badge(n) = box(
  width: 20pt, height: 20pt,
  fill: primary, radius: 10pt,
  align(center + horizon,
    text(size: 10pt, weight: "bold", fill: white, str(n))
  )
)

// ── Helper: page title with accent bar ───────────────
#let ptitle(t) = [
  #text(size: 20pt, weight: "bold", fill: primary, t)
  #v(1mm)
  #rect(width: title-bar-w, height: 3mm, fill: primary)
  #v(6mm)
]

// ── Helper: task card (num: none = no badge) ─────────
#let tcard(num: none, title: "", inset: card-inset, colspan: 1, body) = grid.cell(
  colspan: colspan, inset: 0pt, fill: none, stroke: none,
)[
  #block(
    width: 100%,
    fill: gradient.linear(white, rgb("#f7fbff"), dir: ttb),
    stroke: (top: card-stroke-top + primary, rest: card-stroke-rest + lc),
    radius: card-radius, inset: inset,
  )[
    #if num != none [
      #grid(
        columns: (auto, 1fr),
        gutter: 5mm,
        align: horizon,
        badge(num),
        text(size: 10pt, weight: "bold", fill: primary, upper(title))
      )
    ] else [
      #text(size: 10pt, weight: "bold", fill: primary, upper(title))
    ]
    #line(length: 100%, stroke: 1pt + lc)
    #v(2mm)
    #set text(size: 9pt, fill: muted)
    #set par(leading: 4pt)
    #body
  ]
]

// ── Helper: full-width section intro box ─────────────
#let sintro(title, colspan: 2, body) = grid.cell(
  colspan: colspan, inset: 0pt, fill: none, stroke: none,
)[
  #block(
    width: 100%,
    fill: gradient.linear(rgb("#eef5ff"), white, dir: ltr),
    stroke: (left: 5pt + primary, top: 1.5pt + lc,
             bottom: 1.5pt + lc, right: 1.5pt + lc),
    radius: card-radius, inset: (x: 7mm, y: 5mm),
  )[
    #text(size: 11pt, weight: "bold", fill: primary, upper(title))
    #v(3mm)
    #set text(size: 9pt, fill: muted)
    #set par(leading: 4pt)
    #body
  ]
]

// ── Helper: info / warning / success / danger box ────
#let ibox(type: "note", label: auto, colspan: 2, body) = {
  let (bg, bc, default-label) = if type == "warning" { (warn-bg, warn-c, "Warning")   }
    else if type == "success"  { (ok-bg,  ok-c,  "Confirmed") }
    else if type == "danger"   { (dng-bg, dng-c, "Critical")  }
    else                        { (tint2,  primary, "Note")    }
  let lbl = if label == auto  { default-label }
       else if label == none  { none }
       else                   { label }
  grid.cell(
    colspan: colspan, inset: 0pt, fill: none, stroke: none,
  )[
    #block(
      width: 100%, fill: bg,
      stroke: (left: 4pt + bc, top: none, bottom: none, right: none),
      radius: (right: card-radius), inset: (x: 7mm, y: 5mm),
    )[
      #if lbl != none [
        #text(size: 8pt, weight: "bold", fill: bc, upper(lbl))
        #v(1.5mm)
        #line(length: 100%, stroke: 0.5pt + bc.transparentize(60%))
        #v(2mm)
      ]
      #set text(size: 9pt, fill: muted)
      #set par(leading: 4pt)
      #body
    ]
  ]
}

// ── Helper: inline tab screenshot ────────────────────
#let tabimg(name) = box(
  height: 5.5mm,
  baseline: -30%,
  image("/images/" + name)
)`;
  }

  function pageSetup(primary, logoPath) {
    const logoOrBlank = logoPath
      ? `image(${JSON.stringify(logoPath)}, height: 7mm)`
      : `[]`;
    return `
// ── Page setup ───────────────────────────────────────
#set page(
  paper: "a4",
  margin: (left: 25mm, right: 20mm, top: 18mm, bottom: 26mm),
  background: {
    place(top + left,
      rect(width: 7mm, height: 297mm, fill: primary))
    place(top + right,
      rect(width: 1.2mm, height: 297mm,
           fill: primary.transparentize(60%)))
  },
  footer: context [
    #line(length: 100%, stroke: 1.5pt + lc)
    #v(2mm)
    #set text(size: 8pt, fill: muted)
    #grid(
      columns: (1fr, auto, 1fr),
      gutter: 4mm,
      align: horizon,
      fsec.get(),
      if footer-center != "" { text(size: 8pt, fill: muted, footer-center) } else { ${logoOrBlank} },
      align(right + horizon,
        if counter(page).get().first() > 0 {
          text(fill: primary, weight: "bold", counter(page).display())
        }
      )
    )
  ]
)

#set text(font: ("Source Sans 3", "Segoe UI", "Noto Sans", "Arial"),
          size: 10pt, fill: ink)
#set list(indent: 5mm, body-indent: 2mm, spacing: 2mm)
#set enum(indent: 5mm, body-indent: 2mm, spacing: 1.5mm)
#set par(leading: 5pt)`;
  }

  function escTyp(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  // ── Template catalogue ─────────────────────────────

  const TEMPLATES = [
    {
      id: 'blank',
      name: 'Blank Document',
      abbr: 'BL',
      description: 'All helpers ready, one empty page. Build from scratch.',
      fields: [
        { id: 'title',   label: 'Document Title', type: 'text',  default: 'New Document',   placeholder: 'My Document' },
        { id: 'primary', label: 'Primary Colour',  type: 'color', default: '#0071c0' },
        { id: 'filename',label: 'Filename',         type: 'text',  default: 'document.typ',  placeholder: 'document.typ' },
      ],
    },
    {
      id: 'manual',
      name: 'Service Manual',
      abbr: 'SM',
      description: 'Cover page, table of contents, and numbered content sections.',
      fields: [
        { id: 'title',    label: 'Manual Title',        type: 'text',   default: 'Service Manual', placeholder: 'My Service Manual' },
        { id: 'subtitle', label: 'Subtitle / Version',  type: 'text',   default: 'v1.0',           placeholder: 'v1.0' },
        { id: 'author',   label: 'Author / Company',    type: 'text',   default: '',               placeholder: 'Acme Corp' },
        { id: 'primary',  label: 'Primary Colour',       type: 'color',  default: '#0071c0' },
        { id: 'sections', label: 'Number of sections',  type: 'number', default: '3', min: 1, max: 15 },
        { id: 'sectionNames', label: 'Section names',   type: 'section-list', default: '', dependsOn: 'sections' },
        { id: 'filename', label: 'Filename',              type: 'text',   default: 'manual.typ',    placeholder: 'manual.typ' },
      ],
    },
    {
      id: 'quickref',
      name: 'Quick Reference',
      abbr: 'QR',
      description: 'Three-column reference card layout, no numbered badges.',
      fields: [
        { id: 'title',    label: 'Document Title',      type: 'text',   default: 'Quick Reference', placeholder: 'Quick Reference' },
        { id: 'subtitle', label: 'Subtitle',             type: 'text',   default: '',               placeholder: 'Optional subtitle' },
        { id: 'primary',  label: 'Primary Colour',       type: 'color',  default: '#0071c0' },
        { id: 'cards',    label: 'Number of cards',      type: 'number', default: '6', min: 1, max: 30 },
        { id: 'filename', label: 'Filename',              type: 'text',   default: 'quick-ref.typ',  placeholder: 'quick-ref.typ' },
      ],
    },
    {
      id: 'report',
      name: 'Simple Report',
      abbr: 'SR',
      description: 'Two-column report with section intros and info boxes.',
      fields: [
        { id: 'title',    label: 'Report Title',         type: 'text',   default: 'Report',         placeholder: 'My Report' },
        { id: 'subtitle', label: 'Subtitle / Date',      type: 'text',   default: '',               placeholder: 'March 2026' },
        { id: 'primary',  label: 'Primary Colour',       type: 'color',  default: '#0071c0' },
        { id: 'sections', label: 'Number of sections',   type: 'number', default: '3', min: 1, max: 10 },
        { id: 'sectionNames', label: 'Section names',    type: 'section-list', default: '', dependsOn: 'sections' },
        { id: 'filename', label: 'Filename',               type: 'text',   default: 'report.typ',    placeholder: 'report.typ' },
      ],
    },
  ];

  // ── Source generators ──────────────────────────────

  function generate(templateId, values) {
    const gen = { blank: genBlank, manual: genManual, quickref: genQuickRef, report: genReport };
    if (!gen[templateId]) throw new Error('Unknown template: ' + templateId);
    return gen[templateId](values);
  }

  function getSectionNames(values, nSec) {
    if (Array.isArray(values.sectionNames) && values.sectionNames.length >= nSec) {
      return values.sectionNames.slice(0, nSec);
    }
    return Array.from({ length: nSec }, (_, i) =>
      (Array.isArray(values.sectionNames) && values.sectionNames[i]) ||
      `Section ${i + 1}`
    );
  }

  function genBlank(v) {
    const primary = v.primary || '#0071c0';
    const title   = v.title   || 'New Document';
    return `// ${escTyp(title)}\n` +
      helperDefs(primary) +
      pageSetup(primary) + `

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAGE 1
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#fsec.update("${escTyp(title)}")

#ptitle("${escTyp(title)}")

#grid(
  columns: (1fr, 1fr),
  gutter: 5mm,
  align: top,
  tcard(num: 1, title: "First Card")[
    Add content here.
  ],
  tcard(num: 2, title: "Second Card")[
    Add content here.
  ],
)
`;
  }

  function genManual(v) {
    const primary  = v.primary  || '#0071c0';
    const title    = v.title    || 'Service Manual';
    const subtitle = v.subtitle || '';
    const author   = v.author   || '';
    const nSec     = Math.min(15, Math.max(1, parseInt(v.sections) || 3));
    const names    = getSectionNames(v, nSec);

    let out = `// ${escTyp(title)}\n` + helperDefs(primary);

    // Cover
    out += `

// ── Cover ───────────────────────────────────────────
#page(
  paper: "a4",
  margin: (top: 22mm, bottom: 26mm, left: 26mm, right: 26mm),
  background: rect(width: 100%, height: 100%, stroke: 2pt + lc, fill: white),
  footer: none,
)[
  #v(1fr)
  #align(center)[
    #text(size: 28pt, weight: "bold", fill: primary, upper("${escTyp(title)}"))
${subtitle ? `    #v(4mm)\n    #text(size: 14pt, fill: muted, "${escTyp(subtitle)}")` : ''}
${author   ? `    #v(3mm)\n    #text(size: 11pt, fill: muted, "${escTyp(author)}")` : ''}
    #v(8mm)
    #rect(width: 60mm, height: 2pt, fill: primary)
  ]
  #v(1fr)
]
`;

    out += pageSetup(primary);

    // Table of Contents
    out += `

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TABLE OF CONTENTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#counter(page).update(0)
#fsec.update("")

#align(center)[
  #text(size: 20pt, weight: "bold", fill: primary, "Contents")
  #v(8mm)
]

`;
    names.forEach((name, i) => {
      out += `#grid(\n  columns: (16pt, 1fr, auto),\n  gutter: 4mm,\n  align: horizon,\n  text(fill: primary, weight: "bold", "${i + 1}"),\n  line(stroke: 0.5pt + lc),\n  text(fill: muted, "${escTyp(name)}")\n)\n#v(2mm)\n`;
    });

    // Sections
    names.forEach((name, i) => {
      out += `
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION ${i + 1}: ${name.toUpperCase()}
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#pagebreak()
#fsec.update("${escTyp(name)}")

#ptitle("${escTyp(name)}")

#grid(
  columns: (1fr, 1fr),
  gutter: 5mm,
  align: top,
  sintro("Overview")[
    Describe this section here.
  ],
  tcard(num: 1, title: "First Step")[
    - Item one
    - Item two
    - Item three
  ],
  tcard(num: 2, title: "Second Step")[
    - Item one
    - Item two
    - Item three
  ],
  ibox(type: "note")[
    Add notes or warnings relevant to this section.
  ],
)
`;
    });

    return out;
  }

  function genQuickRef(v) {
    const primary  = v.primary  || '#0071c0';
    const title    = v.title    || 'Quick Reference';
    const subtitle = v.subtitle || '';
    const nCards   = Math.min(30, Math.max(1, parseInt(v.cards) || 6));

    let cards = '';
    for (let i = 1; i <= nCards; i++) {
      cards += `  tcard(num: none, title: "Card ${i}")[
    - Item one
    - Item two
    - Item three
  ],\n`;
    }

    let out = `// ${escTyp(title)}\n` + helperDefs(primary) + pageSetup(primary);

    out += `

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONTENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#fsec.update("${escTyp(title)}")

#ptitle("${escTyp(title)}")
${subtitle ? `#text(size: 11pt, fill: muted, "${escTyp(subtitle)}")\n#v(4mm)` : ''}

#grid(
  columns: (1fr, 1fr, 1fr),
  gutter: 5mm,
  align: top,
${cards})
`;
    return out;
  }

  function genReport(v) {
    const primary  = v.primary  || '#0071c0';
    const title    = v.title    || 'Report';
    const subtitle = v.subtitle || '';
    const nSec     = Math.min(10, Math.max(1, parseInt(v.sections) || 3));
    const names    = getSectionNames(v, nSec);

    let out = `// ${escTyp(title)}\n` + helperDefs(primary) + pageSetup(primary);

    // Title page
    out += `

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TITLE PAGE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#counter(page).update(0)
#fsec.update("")

#v(30mm)
#align(center)[
  #text(size: 24pt, weight: "bold", fill: primary, "${escTyp(title)}")
${subtitle ? `  #v(5mm)\n  #text(size: 13pt, fill: muted, "${escTyp(subtitle)}")` : ''}
  #v(8mm)
  #rect(width: 50mm, height: 2pt, fill: primary)
]
#v(1fr)
`;

    // Sections
    names.forEach((name, i) => {
      out += `
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ${name.toUpperCase()}
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#pagebreak()
#fsec.update("${escTyp(name)}")

#ptitle("${escTyp(name)}")

#grid(
  columns: (1fr, 1fr),
  gutter: 5mm,
  align: top,
  sintro("Overview")[
    Describe this section here.
  ],
  tcard(num: none, title: "Key Points")[
    - Point one
    - Point two
    - Point three
  ],
  tcard(num: none, title: "Details")[
    - Detail one
    - Detail two
    - Detail three
  ],
  ibox(type: "note")[
    Add notes relevant to "${escTyp(name)}".
  ],
)
`;
    });

    return out;
  }

  return { TEMPLATES, generate };

})();
