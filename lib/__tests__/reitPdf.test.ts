// @vitest-environment node
/**
 * Tests for the REIT report PDF renderer.
 *
 * The thing worth testing here is not "did it return bytes" — a renderer that
 * silently dropped every table would still do that. Each test therefore asserts
 * that specific CONTENT reached the page, by rendering uncompressed and reading
 * the drawn text back out of the PDF's content streams.
 *
 * The extractor below reads PDFKit's show-text operators directly rather than
 * pulling in a PDF parser; see `drawnText` for the exact encoding.
 */
import { describe, expect, it } from "vitest";

import { renderReportPdf, reportPdfFilename } from "@/lib/reitPdf";
import type { ReitReportDetail } from "@/lib/reitResearch";

function detail(over: Partial<ReitReportDetail> = {}): ReitReportDetail {
  return {
    id: "arr:11111111-1111-4111-8111-111111111111",
    issuerSymbol: "ARR",
    issuerName: "ARMOUR Residential REIT",
    title: "ARR Adds $734mm to Portfolio in August",
    portfolioDate: "2026-08-31",
    publicationDate: "2026-09-11",
    version: 1,
    bodyMarkdown: "",
    ...over,
  };
}

/**
 * Text PDFKit actually drew, concatenated. Requires `compress: false`.
 *
 * PDFKit emits show-text operations as a TJ array of HEX strings with kerning
 * offsets between them, e.g. `[<48656c6c6f> -12 <20776f726c64> 0] TJ`, using
 * WinAnsi single-byte encoding for the standard-14 fonts. So: find each TJ array,
 * pull the hex literals out of it, and decode. Scoping to TJ arrays matters —
 * hex strings also appear in the file ID and elsewhere in the trailer.
 */
function drawnText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const out: string[] = [];
  const arrays = /\[((?:<[0-9a-fA-F]*>|[-\d.]+|\s)*)\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = arrays.exec(raw)) !== null) {
    const hexes = m[1].match(/<([0-9a-fA-F]*)>/g) ?? [];
    // One TJ array is ONE run of text; the numbers between the hex literals are
    // kerning offsets, not spaces. Joining the fragments with a separator would
    // turn "Portfolio" into "P or tf olio" and make every assertion below lie.
    const run = hexes
      .map((h) => Buffer.from(h.slice(1, -1), "hex").toString("latin1"))
      .join("");
    if (run) out.push(run);
  }
  return out.join(" ");
}

/**
 * How many pages the document says it has, read from the footer the renderer
 * stamps ("Page N of M").
 *
 * Deliberately NOT counted by grepping `/Type /Page` in the raw bytes: that also
 * matches page-tree bookkeeping and over-reports (6 objects for a 2-page file).
 * Reading the stamped footer tests the number the READER actually sees, which is
 * the thing that must be right.
 */
function pageTotal(pdf: Buffer): number {
  const m = drawnText(pdf).match(/Page \d+ of (\d+)/);
  return m ? Number(m[1]) : 0;
}

async function render(over: Partial<ReitReportDetail> = {}): Promise<Buffer> {
  return renderReportPdf(detail(over), { compress: false });
}

describe("renderReportPdf", () => {
  it("produces a structurally valid PDF", async () => {
    const pdf = await render({ bodyMarkdown: "Hello." });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1").trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("puts the headline and issuer masthead on the page", async () => {
    const text = drawnText(await render({ bodyMarkdown: "Body." }));
    expect(text).toContain("ARR Adds $734mm to Portfolio in August");
    expect(text).toContain("ARMOUR RESIDENTIAL REIT (ARR)");
  });

  it("states the portfolio date in prose, not just as an ISO string", async () => {
    const text = drawnText(await render({ bodyMarkdown: "Body." }));
    expect(text).toContain("Portfolio as of August 31, 2026");
    expect(text).toContain("Published September 11, 2026");
  });

  it("renders headings, paragraphs and list items", async () => {
    const text = drawnText(
      await render({ bodyMarkdown: "# Executive summary\n\nThe portfolio grew.\n\n- alpha\n- beta\n" }),
    );
    expect(text).toContain("Executive summary");
    expect(text).toContain("The portfolio grew.");
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
  });

  it("renders GFM table cells, which is the whole reason this is not a text dump", async () => {
    const md = "| Coupon | Face |\n|---|---:|\n| 6.0 | 734,000 |\n| 5.5 | 221,980 |";
    const text = drawnText(await render({ bodyMarkdown: md }));
    for (const cell of ["Coupon", "Face", "6.0", "734,000", "5.5", "221,980"]) {
      expect(text).toContain(cell);
    }
  });

  it("keeps link targets, since the PDF is read away from the app", async () => {
    const text = drawnText(
      await render({ bodyMarkdown: "See the [filing](https://example.test/x) for detail." }),
    );
    expect(text).toContain("filing");
    expect(text).toContain("https://example.test/x");
  });

  it("preserves emphasis text rather than dropping the marked-up run", async () => {
    const text = drawnText(await render({ bodyMarkdown: "A **bold** and *italic* and `code` run." }));
    expect(text).toContain("bold");
    expect(text).toContain("italic");
    expect(text).toContain("code");
  });

  it("paginates a long report and numbers every page", async () => {
    const md = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} with enough words to wrap.`).join("\n\n");
    const pdf = await render({ bodyMarkdown: md });
    const pages = pageTotal(pdf);
    expect(pages).toBeGreaterThan(1);
    const text = drawnText(pdf);
    // Every page must be stamped, not just the first and last.
    for (let i = 1; i <= pages; i++) expect(text).toContain(`Page ${i} of ${pages}`);
  });

  it("gives paragraphs enough leading that lines cannot overlap", async () => {
    // Regression: the renderer terminated each paragraph with an empty
    // `doc.text("")`, which closed PDFKit's continued chain WITHOUT advancing y.
    // Paragraphs then sat 6.4pt apart while the text was 10pt, so consecutive
    // lines overlapped. Assert the baselines are at least the font size apart.
    const pdf = await render({ bodyMarkdown: "Alpha one.\n\nBeta two.\n\nGamma three." });
    const ys = [...pdf.toString("latin1").matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/g)].map((m) =>
      Number(m[1]),
    );
    const bodyYs = ys.filter((y) => y < 700 && y > 300); // below the masthead, above the footer
    expect(bodyYs.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < bodyYs.length; i++) {
      expect(bodyYs[i - 1] - bodyYs[i]).toBeGreaterThanOrEqual(10);
    }
  });

  it("repeats the table header after a page break", async () => {
    const rows = Array.from({ length: 90 }, (_, i) => `| ${i} | ${i * 1000} |`).join("\n");
    const pdf = await render({ bodyMarkdown: `| Coupon | Face |\n|---|---|\n${rows}` });
    expect(pageTotal(pdf)).toBeGreaterThan(1);
    // Header text appears once per page the table spans, never just once.
    const occurrences = (drawnText(pdf).match(/Coupon/g) ?? []).length;
    expect(occurrences).toBeGreaterThan(1);
  });

  it("does not stamp a footer onto a page it also created", async () => {
    // Regression: the footer is drawn below the bottom margin, which PDFKit
    // treats as overflow and answers by starting a NEW page. Stamping N footers
    // therefore turned a real 3-page report into 9 pages, six of which held
    // nothing but the next footer. The stamped total must equal the number of
    // pages that actually carry footers.
    const md = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} with enough words to wrap.`).join("\n\n");
    const pdf = await render({ bodyMarkdown: md });
    const total = pageTotal(pdf);
    const stamped = (drawnText(pdf).match(/Page \d+ of \d+/g) ?? []).length;
    expect(stamped).toBe(total);
  });

  it("transliterates characters the standard-14 fonts cannot draw", async () => {
    // Regression: the August ARR report's "MoM Δ Value" column header rendered as
    // "MoM 9BValue" because U+0394 has no WinAnsi glyph.
    const text = drawnText(await render({ bodyMarkdown: "| MoM \u0394 Value |\n|---|\n| 1 |" }));
    expect(text).toContain("MoM Delta Value");
    expect(text).not.toContain("9B");
  });

  it("keeps characters WinAnsi CAN draw, like the em dash reports use for n/a", async () => {
    // WinAnsi encodes an em dash as the single byte 0x97, which `drawnText`
    // surfaces as U+0097 because it decodes latin1. Asserting U+2014 here would
    // fail against a PDF that is perfectly correct.
    const text = drawnText(await render({ bodyMarkdown: "Effective duration \u2014 not reported." }));
    expect(text).toContain("Effective duration \u0097 not reported.");
  });

  it("drops a leading H1 that merely repeats the headline", async () => {
    // The stored Markdown opens with the title as an H1 and an italic
    // "Portfolio as of <ISO>" line, both of which the masthead already states.
    // Rendering both printed the title twice and the date twice.
    const pdf = await render({
      bodyMarkdown:
        "# ARR Adds $734mm to Portfolio in August\n\n_Portfolio as of 2026-08-31_\n\n## Executive summary\n\nBody.",
      title: "ARR Adds $734mm to Portfolio in August",
    });
    const text = drawnText(pdf);
    expect((text.match(/ARR Adds \$734mm to Portfolio in August/g) ?? []).length).toBe(1);
    // The masthead's formatted date survives; the body's raw ISO restatement does not.
    expect(text).toContain("Portfolio as of August 31, 2026");
    expect(text).not.toContain("Portfolio as of 2026-08-31");
    expect(text).toContain("Executive summary");
  });

  it("leaves a body alone when its first heading is not the headline", async () => {
    const text = drawnText(
      await render({ bodyMarkdown: "# Something else entirely\n\nBody.", title: "The headline" }),
    );
    expect(text).toContain("Something else entirely");
    expect(text).toContain("The headline"); // masthead
    expect(text).toContain("Body.");
  });

  it("renders an empty report without throwing", async () => {
    const pdf = await render({ bodyMarkdown: "" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(drawnText(pdf)).toContain("no body content");
  });

  it("does not render raw HTML, matching the on-screen renderer", async () => {
    // The page deliberately omits rehype-raw; the PDF must not become the one
    // place where unsanitized markup gets interpreted.
    const text = drawnText(await render({ bodyMarkdown: "<script>alert(1)</script>\n\nAfter." }));
    expect(text).not.toContain("alert(1)");
    expect(text).toContain("After.");
  });

  it("compresses by default", async () => {
    const plain = await renderReportPdf(detail({ bodyMarkdown: "x ".repeat(2000) }), {
      compress: false,
    });
    const packed = await renderReportPdf(detail({ bodyMarkdown: "x ".repeat(2000) }));
    expect(packed.byteLength).toBeLessThan(plain.byteLength);
  });
});

describe("reportPdfFilename", () => {
  it("names the file by issuer and portfolio date", () => {
    expect(reportPdfFilename(detail())).toBe("arr-2026-08-31.pdf");
  });

  it("includes the version only when it is a revision", () => {
    expect(reportPdfFilename(detail({ version: 3 }))).toBe("arr-2026-08-31-v3.pdf");
    expect(reportPdfFilename(detail({ version: 1 }))).toBe("arr-2026-08-31.pdf");
  });

  it("falls back to the publication date when the portfolio date is missing", () => {
    expect(reportPdfFilename(detail({ portfolioDate: null }))).toBe("arr-2026-09-11.pdf");
  });

  it("never produces a path or a quote that could break Content-Disposition", () => {
    const name = reportPdfFilename(
      detail({ issuerSymbol: '../../etc "x', portfolioDate: "2026-08-31" }),
    );
    expect(name).toBe("etcx-2026-08-31.pdf");
    expect(name).not.toMatch(/["/\\]/);
  });

  it("handles an undated report", () => {
    expect(reportPdfFilename(detail({ portfolioDate: null, publicationDate: null }))).toBe(
      "arr-undated.pdf",
    );
  });
});
