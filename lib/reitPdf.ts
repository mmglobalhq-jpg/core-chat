/**
 * Server-only: render a REIT research report's Markdown to a PDF buffer.
 *
 * WHY PDFKIT AND NOT A HEADLESS BROWSER
 * Puppeteer/Playwright would give perfect fidelity with the on-screen render, at
 * the cost of shipping Chromium in the core-chat image — hundreds of megabytes
 * and a second browser runtime on a box that has already had OOM trouble. PDFKit
 * is pure JS, draws real vector text (selectable and searchable, not a
 * screenshot), and uses the PDF standard-14 fonts, so there are no font files to
 * bundle either.
 *
 * The trade is that layout is ours to do. That is the bulk of this file: the
 * Markdown is parsed to an mdast with the SAME remark-gfm the page renders with
 * (so a GFM table in the report is a table here too), then each node is drawn.
 *
 * SECURITY: this module must stay server-only. It is imported exclusively by the
 * export route. It never touches Storage paths or RPC names — it is handed an
 * already-fetched ReitReportDetail — which keeps `app/reits/__tests__/bundleScan`
 * clean by construction.
 */
import PDFDocument from "pdfkit";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import type { ReitReportDetail } from "@/lib/reitResearch";

// Hard server-only boundary, matching lib/supabaseReits and lib/supabaseFunds:
// importing this in the browser is a bug. PDFKit is a Node library, and shipping a
// PDF generator to the client would also put it one careless import away from the
// reader-contract identifiers that `app/reits/__tests__/bundleScan` forbids there.
if (typeof window !== "undefined") {
  throw new Error("lib/reitPdf is server-only and must never be imported in the browser");
}

// --- page geometry (US Letter, points) ---
const MARGIN = 56; // 0.78in — generous enough for a binder, tight enough for tables
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_HEIGHT = 34;
const BODY_BOTTOM = PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT;

// Standard-14 faces: no embedded font files, no licensing, no image bloat.
const FONT = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  boldItalic: "Helvetica-BoldOblique",
  mono: "Courier",
} as const;

const SIZE = { h1: 17, h2: 13.5, h3: 11.5, body: 10, small: 8.5, table: 8.5 } as const;
const INK = { body: "#111111", muted: "#666666", rule: "#cccccc", zebra: "#f4f4f5" } as const;

/**
 * The standard-14 fonts are encoded WinAnsi, so anything outside that repertoire
 * has no glyph and renders as mojibake. This is not hypothetical: the August ARR
 * report uses `Δ` in two column headers, which came out as the literal text
 * "9B" — "MoM 9BValue ($mm)".
 *
 * Embedding a Unicode font would fix it at the cost of bundling font files into
 * the image; for the symbols these reports actually use, transliteration reads
 * better anyway ("MoM Delta Value" beats a box glyph).
 */
const TRANSLITERATE: Record<string, string> = {
  "Δ": "Delta", // Δ — month-over-month change, used in ARR table headers
  "μ": "u",
  "→": "->",
  "←": "<-",
  "≤": "<=",
  "≥": ">=",
  "≈": "~",
  "×": "x",
  "±": "+/-",
  "−": "-",
  "′": "'",
  "″": '"',
};

// WinAnsi's 0x80–0x9F block maps to these glyphs; everything else in that range,
// and everything above U+00FF, is unrepresentable.
const WINANSI_HIGH = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ" +
    "‘’“”•–—˜™š›œžŸ",
);

function winAnsiSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || ch === "\n") {
      out += ch;
    } else if (WINANSI_HIGH.has(ch)) {
      out += ch;
    } else if (TRANSLITERATE[ch]) {
      out += TRANSLITERATE[ch];
    } else {
      // Last resort: strip diacritics (é -> e); drop anything still unmappable
      // rather than emit a glyph the reader will see as corruption.
      const stripped = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += /^[\x20-\x7e]+$/.test(stripped) ? stripped : "";
    }
  }
  return out;
}

/** Minimal mdast shapes — only the fields this renderer reads. */
type MdNode = {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  children?: MdNode[];
  align?: (string | null)[];
  lang?: string | null;
};

type Doc = PDFKit.PDFDocument;

/** Inline run: text plus the marks that apply to it. */
type Run = { text: string; bold: boolean; italic: boolean; code: boolean };

function fontFor(run: Run): string {
  if (run.code) return FONT.mono;
  if (run.bold && run.italic) return FONT.boldItalic;
  if (run.bold) return FONT.bold;
  if (run.italic) return FONT.italic;
  return FONT.regular;
}

/**
 * Flatten an inline subtree into styled runs.
 *
 * Links keep their text and gain the URL in parentheses — a PDF that silently
 * drops where a link pointed is worse than a slightly longer line, and this file
 * is frequently read on paper.
 */
function runsOf(nodes: MdNode[] | undefined, inherited?: Partial<Run>): Run[] {
  const out: Run[] = [];
  const base: Run = { text: "", bold: false, italic: false, code: false, ...inherited };
  for (const n of nodes ?? []) {
    switch (n.type) {
      case "text":
        out.push({ ...base, text: winAnsiSafe(n.value ?? "") });
        break;
      case "strong":
        out.push(...runsOf(n.children, { ...base, bold: true }));
        break;
      case "emphasis":
        out.push(...runsOf(n.children, { ...base, italic: true }));
        break;
      case "inlineCode":
        out.push({ ...base, text: winAnsiSafe(n.value ?? ""), code: true });
        break;
      case "delete":
        // No strikethrough in the standard-14 set; mark it so meaning survives.
        out.push(...runsOf(n.children, base), { ...base, text: " [struck]" });
        break;
      case "break":
        out.push({ ...base, text: "\n" });
        break;
      case "link": {
        out.push(...runsOf(n.children, base));
        const href = (n as unknown as { url?: string }).url;
        if (href && !plain(n.children).includes(href)) {
          out.push({ ...base, text: ` (${href})`, italic: true });
        }
        break;
      }
      case "image":
        out.push({ ...base, text: `[image: ${plain(n.children) || "untitled"}]`, italic: true });
        break;
      default:
        if (n.children) out.push(...runsOf(n.children, base));
        else if (n.value) out.push({ ...base, text: winAnsiSafe(n.value) });
    }
  }
  return out;
}

function plain(nodes: MdNode[] | undefined): string {
  return runsOf(nodes)
    .map((r) => r.text)
    .join("");
}

/**
 * Draw styled runs as one flowing paragraph, wrapping and paginating as needed.
 *
 * The chain MUST be terminated by the last real fragment carrying
 * `continued: false`, not by a trailing `doc.text("")`. While a run is continued
 * PDFKit holds `y` at the start of the line and only advances it when the chain
 * closes; an empty terminator closes the chain without advancing, so every
 * paragraph then started 10pt-of-text into 6pt of space and the lines overlapped.
 */
function drawRuns(doc: Doc, runs: Run[], opts: { size: number; indent?: number; gap?: number }) {
  const indent = opts.indent ?? 0;
  const width = CONTENT_WIDTH - indent;
  const left = MARGIN + indent;

  // Flatten to drawable fragments first so the last one is known up front.
  // A hard break inside a run becomes a newline kept with its fragment, which
  // PDFKit honours inside continued text.
  const frags: { text: string; font: string }[] = [];
  for (const run of runs) {
    if (run.text === "") continue;
    frags.push({ text: run.text, font: fontFor(run) });
  }
  if (frags.length === 0) return;

  doc.fillColor(INK.body);
  ensureRoom(doc, opts.size * 2);
  for (let i = 0; i < frags.length; i++) {
    const last = i === frags.length - 1;
    doc.font(frags[i].font).fontSize(opts.size);
    doc.text(frags[i].text, i === 0 ? left : undefined, i === 0 ? doc.y : undefined, {
      width,
      continued: !last,
      lineGap: 1.5,
    });
  }
  doc.moveDown(opts.gap ?? 0.55);
}

/** Start a new page if `needed` points do not fit above the footer. */
function ensureRoom(doc: Doc, needed: number) {
  if (doc.y + needed > BODY_BOTTOM) doc.addPage();
}

function drawHeading(doc: Doc, node: MdNode) {
  const depth = node.depth ?? 1;
  const size = depth <= 1 ? SIZE.h1 : depth === 2 ? SIZE.h2 : SIZE.h3;
  // Keep a heading with at least a couple of lines of what follows; a heading
  // stranded alone at the foot of a page is the classic generated-PDF tell.
  ensureRoom(doc, size * 3.2);
  doc.moveDown(depth <= 2 ? 0.7 : 0.5);
  doc.font(FONT.bold).fontSize(size).fillColor(INK.body);
  doc.text(plain(node.children), MARGIN, doc.y, { width: CONTENT_WIDTH });
  if (depth <= 2) {
    const y = doc.y + 3;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.5).strokeColor(INK.rule).stroke();
    doc.y = y + 6;
  } else {
    doc.moveDown(0.3);
  }
}

function drawList(doc: Doc, node: MdNode, depth = 0) {
  const ordered = node.ordered === true;
  let n = 1;
  for (const item of node.children ?? []) {
    const marker = ordered ? `${n}.` : "•";
    n++;
    const indent = 14 + depth * 14;
    // The marker sits in the gutter; the item text wraps against the same indent.
    for (const child of item.children ?? []) {
      if (child.type === "list") {
        drawList(doc, child, depth + 1);
        continue;
      }
      const runs = runsOf(child.children ?? [child]);
      if (runs.length === 0) continue;
      ensureRoom(doc, doc.currentLineHeight(true) * 1.4);
      const top = doc.y;
      doc.font(FONT.regular).fontSize(SIZE.body).fillColor(INK.muted);
      doc.text(marker, MARGIN + depth * 14, top, { width: 12 });
      doc.y = top;
      drawRuns(doc, runs, { size: SIZE.body, indent, gap: 0.25 });
    }
  }
  doc.moveDown(0.35);
}

function drawBlockquote(doc: Doc, node: MdNode) {
  const top = doc.y;
  for (const child of node.children ?? []) {
    drawBlock(doc, child, 16);
  }
  // Rule drawn after, so it spans however far the quote actually ran. A quote
  // that crossed a page boundary gets a rule on the last page only, which is
  // honest: we cannot retroactively draw on a page PDFKit has already flushed.
  if (doc.y > top) {
    doc.moveTo(MARGIN + 4, top).lineTo(MARGIN + 4, doc.y - 4).lineWidth(2).strokeColor(INK.rule).stroke();
  }
}

function drawCode(doc: Doc, node: MdNode) {
  const lines = winAnsiSafe(node.value ?? "").split("\n");
  doc.moveDown(0.35);
  doc.font(FONT.mono).fontSize(SIZE.small).fillColor(INK.body);
  for (const line of lines) {
    ensureRoom(doc, doc.currentLineHeight(true));
    doc.text(line, MARGIN + 8, doc.y, { width: CONTENT_WIDTH - 8, lineGap: 1 });
  }
  doc.moveDown(0.5);
}

// --- tables ------------------------------------------------------------------
// GFM tables are the reason this file is not thirty lines. Reports carry coupon
// and position tables, and a report whose tables collapse into run-on prose is
// not a usable export.

type Cell = { runs: Run[]; text: string };

function tableMatrix(node: MdNode): Cell[][] {
  return (node.children ?? []).map((row) =>
    (row.children ?? []).map((cell) => {
      const runs = runsOf(cell.children);
      return { runs, text: runs.map((r) => r.text).join("") };
    }),
  );
}

/**
 * Column widths from content, not equal thirds.
 *
 * Measure every cell's natural width, give each column what its widest cell
 * wants, then scale down proportionally if the total overflows. Equal columns
 * would wrap a "Coupon" column onto three lines while a wide notes column sat
 * half empty.
 */
function columnWidths(doc: Doc, rows: Cell[][], cols: number): number[] {
  const want = new Array<number>(cols).fill(0);
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (c >= cols) return;
      doc.font(r === 0 ? FONT.bold : FONT.regular).fontSize(SIZE.table);
      const w = doc.widthOfString(cell.text) + 12;
      if (w > want[c]) want[c] = w;
    });
  });
  const total = want.reduce((a, b) => a + b, 0);
  if (total <= CONTENT_WIDTH) {
    // Distribute the slack so the table fills the measure rather than floating.
    const extra = (CONTENT_WIDTH - total) / cols;
    return want.map((w) => w + extra);
  }
  const MIN = 34;
  const scaled = want.map((w) => Math.max(MIN, (w / total) * CONTENT_WIDTH));
  const over = scaled.reduce((a, b) => a + b, 0) - CONTENT_WIDTH;
  if (over > 0) {
    // Trim the widest column(s) rather than squeezing the narrow ones below MIN.
    const widest = scaled.indexOf(Math.max(...scaled));
    scaled[widest] = Math.max(MIN, scaled[widest] - over);
  }
  return scaled;
}

function drawTable(doc: Doc, node: MdNode) {
  const rows = tableMatrix(node);
  if (rows.length === 0) return;
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols === 0) return;
  const widths = columnWidths(doc, rows, cols);
  const align = (node.align ?? []) as (string | null)[];
  const PAD = 5;

  const rowHeight = (row: Cell[], bold: boolean) => {
    let h = 0;
    row.forEach((cell, c) => {
      doc.font(bold ? FONT.bold : FONT.regular).fontSize(SIZE.table);
      const hh = doc.heightOfString(cell.text || " ", { width: widths[c] - PAD * 2 });
      if (hh > h) h = hh;
    });
    return h + PAD * 2;
  };

  const header = rows[0];
  const headerH = rowHeight(header, true);

  const drawRow = (row: Cell[], bold: boolean, h: number, zebra: boolean) => {
    const top = doc.y;
    if (zebra) doc.rect(MARGIN, top, CONTENT_WIDTH, h).fill(INK.zebra);
    let x = MARGIN;
    row.forEach((cell, c) => {
      doc.font(bold ? FONT.bold : FONT.regular).fontSize(SIZE.table).fillColor(INK.body);
      doc.text(cell.text, x + PAD, top + PAD, {
        width: widths[c] - PAD * 2,
        align: (align[c] as "left" | "right" | "center" | undefined) ?? "left",
      });
      x += widths[c];
    });
    doc.y = top + h;
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_WIDTH, doc.y).lineWidth(0.4).strokeColor(INK.rule).stroke();
  };

  doc.moveDown(0.4);
  ensureRoom(doc, headerH + 24); // never strand a header row alone
  drawRow(header, true, headerH, false);

  for (let i = 1; i < rows.length; i++) {
    const h = rowHeight(rows[i], false);
    if (doc.y + h > BODY_BOTTOM) {
      // Repeat the header after a page break, or the continuation is unreadable.
      doc.addPage();
      drawRow(header, true, headerH, false);
    }
    drawRow(rows[i], false, h, i % 2 === 0);
  }
  doc.moveDown(0.6);
}

function drawBlock(doc: Doc, node: MdNode, indent = 0) {
  switch (node.type) {
    case "heading":
      drawHeading(doc, node);
      break;
    case "paragraph":
      drawRuns(doc, runsOf(node.children), { size: SIZE.body, indent });
      break;
    case "list":
      drawList(doc, node);
      break;
    case "table":
      drawTable(doc, node);
      break;
    case "code":
      drawCode(doc, node);
      break;
    case "blockquote":
      drawBlockquote(doc, node);
      break;
    case "thematicBreak": {
      ensureRoom(doc, 18);
      doc.moveDown(0.4);
      doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_WIDTH, doc.y).lineWidth(0.5).strokeColor(INK.rule).stroke();
      doc.moveDown(0.6);
      break;
    }
    case "html":
      // Raw HTML is deliberately not rendered on screen either (no rehype-raw);
      // dropping it here keeps the PDF and the page saying the same thing.
      break;
    default:
      if (node.children?.length) for (const c of node.children) drawBlock(doc, c, indent);
  }
}


/** Normalize for comparison: case, whitespace and punctuation spacing only. */
function normalizeTitle(t: string): string {
  return winAnsiSafe(t).toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Drop a leading H1 that merely repeats the report title, plus an immediately
 * following one-line "Portfolio as of ..." restatement.
 *
 * Deliberately conservative: it stops at the first block that is not one of those
 * two things, and the heading must match the title exactly once normalized. A
 * body that opens with real content keeps every block.
 */
export function stripDuplicateMasthead(blocks: MdNode[], report: ReitReportDetail): MdNode[] {
  let i = 0;
  if (
    blocks[i]?.type === "heading" &&
    blocks[i].depth === 1 &&
    normalizeTitle(plain(blocks[i].children)) === normalizeTitle(report.title)
  ) {
    i++;
    const next = blocks[i];
    if (next?.type === "paragraph" && /^portfolio as of\b/i.test(plain(next.children).trim())) {
      i++;
    }
  }
  return blocks.slice(i);
}

export function reportPdfFilename(report: ReitReportDetail): string {
  const issuer = (report.issuerSymbol || "reit").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const date = report.portfolioDate ?? report.publicationDate ?? "undated";
  const version = report.version && report.version > 1 ? `-v${report.version}` : "";
  return `${issuer}-${date}${version}.pdf`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Render one report to PDF bytes.
 *
 * Resolves only once PDFKit has flushed every page, so the caller always gets a
 * complete document — a truncated PDF opens as a corrupt file, which is a far
 * worse failure than an error response.
 */
export async function renderReportPdf(
  report: ReitReportDetail,
  opts: { compress?: boolean } = {},
): Promise<Buffer> {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(report.bodyMarkdown ?? "") as MdNode;

  const doc = new PDFDocument({
    size: "LETTER",
    // Off only in tests, where the point is to read the drawn text back out of the
    // bytes and assert the report actually rendered rather than that it merely
    // produced a file. Production always compresses.
    compress: opts.compress !== false,
    margins: { top: MARGIN, bottom: MARGIN + FOOTER_HEIGHT, left: MARGIN, right: MARGIN },
    bufferPages: true, // needed to stamp "Page N of M" once the total is known
    info: {
      Title: report.title,
      Author: report.issuerName,
      Subject: `${report.issuerName} (${report.issuerSymbol}) — portfolio as of ${report.portfolioDate ?? "n/a"}`,
      Creator: "MMGlobal REIT Research",
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // --- masthead ---
  doc.font(FONT.bold).fontSize(SIZE.small).fillColor(INK.muted);
  doc.text(winAnsiSafe(`${report.issuerName} (${report.issuerSymbol})`.toUpperCase()), MARGIN, MARGIN, {
    width: CONTENT_WIDTH,
    characterSpacing: 0.6,
  });
  doc.moveDown(0.2);
  doc.font(FONT.regular).fontSize(SIZE.small).fillColor(INK.muted);
  const meta = [
    report.portfolioDate ? `Portfolio as of ${fmtDate(report.portfolioDate)}` : null,
    report.publicationDate ? `Published ${fmtDate(report.publicationDate)}` : null,
    report.version && report.version > 1 ? `Version ${report.version}` : null,
  ].filter(Boolean);
  doc.text(meta.join("  ·  "), { width: CONTENT_WIDTH });
  doc.moveDown(0.5);
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_WIDTH, doc.y).lineWidth(1).strokeColor(INK.body).stroke();
  doc.moveDown(0.8);

  // --- headline ---
  doc.font(FONT.bold).fontSize(SIZE.h1).fillColor(INK.body);
  doc.text(winAnsiSafe(report.title), MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 2 });
  doc.moveDown(0.9);

  // --- body ---
  // The stored Markdown repeats what the masthead above already states: it opens
  // with an H1 of the headline and an italic "Portfolio as of <ISO>" line. Drawing
  // both puts the title on the page twice and the date twice (once formatted,
  // once raw ISO), which is what the first real export looked like.
  //
  // Only an EXACT title match is dropped, and only at the very top — a report
  // whose body genuinely differs is left completely alone.
  const blocks = stripDuplicateMasthead(tree.children ?? [], report);
  if (blocks.length === 0) {
    doc.font(FONT.italic).fontSize(SIZE.body).fillColor(INK.muted);
    doc.text("This report has no body content.", MARGIN, doc.y, { width: CONTENT_WIDTH });
  } else {
    for (const block of blocks) drawBlock(doc, block);
  }

  // --- footers (after layout, so the page total is real) ---
  const range = doc.bufferedPageRange();
  const generated = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // The footer is drawn BELOW the bottom margin on purpose. PDFKit treats any
    // text past that margin as overflow and silently starts a new page, so
    // stamping N footers turned a 3-page report into 9 pages, each new one
    // carrying nothing but the next footer. Zeroing the margin for the stamp is
    // what keeps the write on the page it belongs to.
    doc.page.margins.bottom = 0;
    const y = PAGE_HEIGHT - MARGIN - 14;
    doc.moveTo(MARGIN, y - 8).lineTo(MARGIN + CONTENT_WIDTH, y - 8).lineWidth(0.4).strokeColor(INK.rule).stroke();
    doc.font(FONT.regular).fontSize(SIZE.small).fillColor(INK.muted);
    doc.text(
      `${report.issuerSymbol} · ${report.portfolioDate ?? ""}`,
      MARGIN,
      y,
      { width: CONTENT_WIDTH / 2, lineBreak: false },
    );
    doc.text(`Generated ${generated}  ·  Page ${i + 1} of ${range.count}`, MARGIN + CONTENT_WIDTH / 2, y, {
      width: CONTENT_WIDTH / 2,
      align: "right",
      lineBreak: false,
    });
  }

  doc.end();
  return done;
}
