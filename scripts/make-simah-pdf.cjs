/**
 * Prints one of the made-up SIMAH texts as a real PDF: tests/fixtures/simah-made-up.pdf.
 *
 * The test suite reads that file with the same PDF reader the upload uses and expects the reading
 * production gave for the text. It is the one test that goes through the PDF itself, so it is what
 * fails when the PDF library is upgraded and lays text out differently.
 *
 * Run only to make the file again: node scripts/make-simah-pdf.cjs [case number]
 * It needs Playwright with Chromium, which is not a dependency of the project.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const { cases } = JSON.parse(fs.readFileSync(path.join(root, "tests/golden/simah.json"), "utf8"));
const font = (name) => `data:font/woff2;base64,${fs.readFileSync(path.join(root, "public/fonts", name)).toString("base64")}`;
const escaped = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * Extraction returns each Arabic word of a SIMAH report with its letters in reverse, and the stored
 * texts hold them that way. A word printed in reverse is extracted the right way round, so each word
 * is turned back before printing: what comes out of the PDF is then the stored text.
 */
const turned = (text) => text.replace(/[؀-ۿ]+/g, (word) => [...word].reverse().join(""));

(async () => {
  const index = Number(process.argv[2] ?? 0);
  const html = `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: R; src: url(${font("rubik-arabic.woff2")}); unicode-range: U+0600-06FF; }
    @font-face { font-family: R; src: url(${font("rubik-latin.woff2")}); }
    body { font: 11px/2 R; }
    section { page-break-after: always; white-space: pre; direction: ltr; unicode-bidi: bidi-override; }
  </style>${cases[index].pages.map((page) => `<section>${escaped(turned(page))}</section>`).join("")}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(root, "tests/fixtures/simah-made-up.pdf");
  fs.writeFileSync(out, await page.pdf({ format: "A4" }));
  await browser.close();
  console.log(`case ${index + 1} of ${cases.length} written to ${out}`);
})();
