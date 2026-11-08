// Builds the social preview image, site/assets/og.png (1200 x 630), from
// content.json, the hero field lines and the logo mark: writes tools/og.svg
// (the picture, for review) and rasterises it with resvg, so the result is the
// same on every machine and needs no browser. Run from the repo root:
//   node tools/og.js
// Fonts: the static instances in tools/fonts/ (made from the site's variable
// woff2 with fontTools, see tools/README.md); SVG rasterisers read TTF only.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { readContent } from "./content.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SVG_OUT = path.join(ROOT, "tools", "og.svg");
export const PNG_OUT = path.join(ROOT, "site", "assets", "og.png");
const FONTS = [500, 600].map((w) => path.join(ROOT, "tools", "fonts", `schibsted-grotesk-latin-${w}.ttf`));

/* ---- Layout, in px of the 1200 x 630 image --------------------------------- */
const W = 1200, H = 630;
const BG = "#0D0F22", FG = "#E8EAF2", MUTED = "#A2A8C0", ACCENT = "#8AB6F9";
const FAMILY = "Schibsted Grotesk";
const LEFT = 88;                 // text column
const GAP = 36;                  // between brand row, headline and lead
const LOGO = 64, LOGO_GAP = 18;  // brand row: mark, then the wordmark
const BRAND = { size: 26, weight: 600, spacing: 0.22 };            // wordmark, uppercase, em spacing
const TITLE = { size: 84, weight: 500, line: 1.02, spacing: -0.035, width: 700 };
const LEAD = { size: 22, weight: 500, line: 1.45, width: 560 };
// The field lines (the hero's static drawing, viewBox 640 x 500) sit off the
// right edge, faded out towards their edge by a radial mask.
const LINES = { height: 680, right: -230, top: -25, viewW: 640, viewH: 500, stroke: 1.1, opacity: 0.55, fade: [0.55, 1] };

const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fontOptions = { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: FAMILY };

// Width of a run of text as resvg will set it: render it alone and measure.
function textWidth(text, { size, weight, spacing = 0 }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="400"><text x="0" y="200" font-family="${FAMILY}" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing * size}">${escape(text)}</text></svg>`;
  const box = new Resvg(svg, { font: fontOptions }).getBBox();
  return box ? box.width : 0;
}

// Greedy word wrap to the column width.
function wrap(text, style) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const trial = line ? `${line} ${word}` : word;
    if (line && textWidth(trial, style) > style.width) { lines.push(line); line = word; }
    else line = trial;
  }
  if (line) lines.push(line);
  return lines;
}

// Field-line paths from the page: tools/fieldlines.py writes them between the markers.
function fieldLinePaths() {
  const html = readFileSync(path.join(ROOT, "site", "index.html"), "utf8");
  const m = html.match(/<!-- FIELD-LINES:START -->([\s\S]*?)<!-- FIELD-LINES:END -->/);
  if (!m) throw new Error("no FIELD-LINES block in site/index.html");
  // Drop the page's per-path style hooks; the picture sets its own stroke.
  return m[1].replace(/ pathLength="1"/g, "").replace(/ style="--i:\d+"/g, "").trim();
}

export function buildSvg(content = readContent()) {
  const titleLines = wrap(content.hero.title, TITLE);
  const leadLines = wrap(content.hero.lead, LEAD);
  const titleH = titleLines.length * TITLE.size * TITLE.line;
  const leadH = leadLines.length * LEAD.size * LEAD.line;
  const blockH = LOGO + GAP + titleH + GAP + leadH;
  let y = (H - blockH) / 2;

  // Baseline of a line box: its centre plus about a third of the size (cap height / 2).
  const baseline = (top, size, line) => top + (size * line) / 2 + size * 0.36;
  const textLines = (lines, style, x, top, fill, extra = "") => lines.map((t, i) =>
    `  <text x="${x}" y="${baseline(top + i * style.size * style.line, style.size, style.line).toFixed(1)}" font-size="${style.size}" font-weight="${style.weight}"${extra} fill="${fill}">${escape(t)}</text>`).join("\n");

  const logo = readFileSync(path.join(ROOT, "site", "assets", "logo-mark-dark.png")).toString("base64");
  const brand = [
    `  <image x="${LEFT}" y="${y}" width="${LOGO}" height="${LOGO}" href="data:image/png;base64,${logo}"/>`,
    textLines([content.header.wordmark.toUpperCase()], { ...BRAND, line: LOGO / BRAND.size }, LEFT + LOGO + LOGO_GAP, y, FG,
      ` letter-spacing="${(BRAND.spacing * BRAND.size).toFixed(2)}"`),
  ].join("\n");
  y += LOGO + GAP;
  const title = textLines(titleLines, TITLE, LEFT, y, FG, ` letter-spacing="${(TITLE.spacing * TITLE.size).toFixed(2)}"`);
  y += titleH + GAP;
  const lead = textLines(leadLines, LEAD, LEFT, y, MUTED);

  const linesW = (LINES.height * LINES.viewW) / LINES.viewH;
  const linesX = W - LINES.right - linesW, linesY = LINES.top;
  const scale = LINES.height / LINES.viewH;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FAMILY}">
  <!-- Generated by tools/og.js from content.json; edit those, not this file. -->
  <defs>
    <radialGradient id="fade" cx="0.5" cy="0.5" r="0.5">
      <stop offset="${LINES.fade[0]}" stop-color="#fff"/>
      <stop offset="${LINES.fade[1]}" stop-color="#000"/>
    </radialGradient>
    <mask id="lines-mask" maskUnits="userSpaceOnUse" x="${linesX.toFixed(1)}" y="${linesY}" width="${linesW.toFixed(1)}" height="${LINES.height}">
      <rect x="${linesX.toFixed(1)}" y="${linesY}" width="${linesW.toFixed(1)}" height="${LINES.height}" fill="url(#fade)"/>
    </mask>
  </defs>
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <g mask="url(#lines-mask)">
    <g transform="translate(${linesX.toFixed(1)} ${linesY}) scale(${scale.toFixed(4)})"
       fill="none" stroke="${ACCENT}" stroke-opacity="${LINES.opacity}" stroke-width="${LINES.stroke}" stroke-linecap="round">
${fieldLinePaths()}
    </g>
  </g>
${brand}
${title}
${lead}
</svg>
`;
}

export function renderPng(svg) {
  return new Resvg(svg, { font: fontOptions, fitTo: { mode: "original" } }).render().asPng();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const svg = buildSvg();
  writeFileSync(SVG_OUT, svg);
  writeFileSync(PNG_OUT, renderPng(svg));
  console.log(`og: wrote ${path.relative(ROOT, SVG_OUT)} and ${path.relative(ROOT, PNG_OUT)}`);
}
