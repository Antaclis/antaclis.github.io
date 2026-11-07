// tests/content.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const html = readFileSync("site/index.html", "utf8");
const css = readFileSync("site/styles.css", "utf8");
// What a visitor can read: no doctype, comments or SVG path data.
const visible = html.replace(/<!doctype[^>]*>/i, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "");

test("forbidden words and old details are gone", () => {
  for (const bad of [/compan(y|ies)/i, /startup/i, /spin-?off/i, /founder/i, /registered/i, /early-stage/i,
                     /research project/i, /gmail\.com/, /antaclis\.github\.io/, /\b0[123]\b/, /→/, /—/, /!/]) {
    assert.ok(!bad.test(visible), `found ${bad}`);
  }
});

test("domain, email and metadata point at antaclis.com", () => {
  assert.equal(readFileSync("site/CNAME", "utf8").trim(), "antaclis.com");
  assert.match(html, /<link rel="canonical" href="https:\/\/antaclis\.com\/">/);
  assert.match(html, /og:url" content="https:\/\/antaclis\.com\/"/);
  assert.match(html, /og:image" content="https:\/\/antaclis\.com\/assets\/og\.png"/);
  assert.ok((html.match(/contact@antaclis\.com/g) || []).length >= 2, "button and visible text");
  assert.match(html, /<title>Antaclis · Seeing through fields<\/title>/);
});

test("the spec's copy is on the page", () => {
  for (const line of ["Seeing through fields.", "Measure.", "Infer.", "That is Antaclis.",
                      "Custom AI solutions for problems built around magnetic quantum sensors.",
                      "Quantum sensors", "Physics simulation", "Machine learning", "Inverse problems",
                      "Write to us", "© 2026 Antaclis"]) {
    assert.ok(html.includes(line), `missing: ${line}`);
  }
});

test("the DOM contract for the stage exists", () => {
  for (const id of ["sequence", "stage", "stage-canvas", "readout", "drag-hint", "work", "team", "contact", "main"]) {
    assert.ok(html.includes(`id="${id}"`), `missing id ${id}`);
  }
  for (const cls of ["beat-hero", "beat-measure", "beat-infer", "beat-landing", "scrim", "caption"]) {
    assert.ok(html.includes(cls), `missing class ${cls}`);
  }
  assert.match(html, /<svg class="field"[^>]*data-fallback/);
  assert.match(html, /<!-- FIELD-LINES:START -->[\s\S]*<!-- FIELD-LINES:END -->/);
  assert.match(html, /<script type="module" src="stage\/stage\.js"><\/script>/);
});

test("fonts are self-hosted and the old ones are gone", () => {
  assert.ok(existsSync("site/fonts/schibsted-grotesk-latin-wght.woff2"));
  assert.ok(existsSync("site/fonts/LICENSE-Schibsted-Grotesk.txt"));
  assert.ok(!existsSync("site/fonts/inter-latin-wght.woff2"));
  assert.ok(!existsSync("site/field.js"));
  assert.match(css, /font-family: "Schibsted Grotesk"/);
  assert.ok(!/prefers-color-scheme: light/.test(css), "dark only");
  assert.ok(!/fonts\.googleapis|cdn\./.test(html + css), "no third-party requests");
});

test("the team section is kept with four people", () => {
  assert.equal((html.match(/class="person"/g) || []).length, 4);
  assert.match(html, /linkedin\.com\/in\/aurelio-amerio/);
});

test("the social preview source matches the page", () => {
  const og = readFileSync("tools/og.html", "utf8");
  assert.ok(!/early-stage|research project|Inter/i.test(og));
  assert.ok(og.includes("Seeing through"));
  assert.ok(og.includes("schibsted-grotesk-latin-wght.woff2"));
});
