// tests/content.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { render, flatten, readContent, TARGETS } from "../tools/content.js";
import { buildSvg } from "../tools/og.js";

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
  assert.match(html, /<a class="button" href="mailto:contact@antaclis\.com[^"]*"[^>]*>Contact us<\/a>/);
  assert.match(html, /<p class="email"[^>]*>contact@antaclis\.com<\/p>/, "address as visible text");
  assert.match(html, /<footer[\s\S]*href="mailto:contact@antaclis\.com"[\s\S]*<\/footer>/, "address in the footer");
  assert.match(html, /<title[^>]*>Antaclis · Seeing through fields<\/title>/);
});

test("the spec's copy is on the page", () => {
  for (const line of ["Seeing through fields.", "Measure.", "Infer.", "That is Antaclis.",
                      "You build the system, we take the measurements.",
                      "Magnetic sensors", "Physics simulation", "Machine learning", "Inverse design",
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

test("the social preview picture is built from content.json and is up to date", () => {
  const svg = readFileSync("tools/og.svg", "utf8");
  assert.equal(buildSvg(), svg, "tools/og.svg is out of step: run node tools/og.js");
  assert.ok(svg.includes("Seeing through"), "the headline is in the picture");
  assert.ok(svg.includes("<path d="), "the field lines are in the picture");
  assert.ok(!/early-stage|research project/i.test(svg));
  assert.ok(existsSync("site/assets/og.png"));
  assert.ok(existsSync("tools/fonts/schibsted-grotesk-latin-500.ttf") && existsSync("tools/fonts/schibsted-grotesk-latin-600.ttf"));
});

test("the HTML carries exactly the text in content.json", () => {
  const content = readContent();
  for (const file of TARGETS) {
    const html = readFileSync(file, "utf8");
    assert.equal(render(html, content), html, `${file} is out of step with content.json: run node tools/content.js`);
  }
});

test("editing content.json changes the page, with escaping and the derived links", () => {
  const content = readContent();
  content.beats.measure.text = "A sensor <reads> the field & more.";
  content.contact.email = "hello@example.org";
  content.contact.subject = "Hi there";
  content.work.topics = content.work.topics.slice(0, 2);
  const out = render(html, content);
  assert.ok(out.includes('<p data-text="beats.measure.text">A sensor &lt;reads&gt; the field &amp; more.</p>'));
  assert.ok(out.includes('href="mailto:hello@example.org?subject=Hi%20there" data-href="contact.mailto_subject" data-text="contact.button">Contact us</a>'));
  assert.ok(out.includes('<a href="mailto:hello@example.org" data-href="contact.mailto" data-text="contact.email">hello@example.org</a>'));
  assert.equal((out.match(/class="topic"/g) || []).length, 2, "the topics list is regenerated");
  assert.equal((out.match(/class="person"/g) || []).length, 4);
  assert.throws(() => render('<p data-text="no.such.key">x</p>', content), /no "no\.such\.key"/);
  assert.ok(!("team._note" in flatten(content)), "editor notes are not keys");
});

test("content.json follows the copy rules too", () => {
  const text = JSON.stringify(readContent());
  for (const bad of [/compan(y|ies)/i, /startup/i, /founder/i, /→/, /—/, /!/]) assert.ok(!bad.test(text), `found ${bad}`);
});
