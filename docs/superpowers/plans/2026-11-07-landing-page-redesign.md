# Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Antaclis landing page around a scroll-driven WebGL simulation (field lines, a scanning plane that records slices, inference that recovers the sources), with the new copy, dark-only visual system, team and contact sections, served at antaclis.com.

**Architecture:** A static site under `site/` with no build step. Three small ES modules: `site/stage/model.js` (the physics: dipole field, field-line tracing, slice sampling; pure, testable in node), `site/stage/sequence.js` (pure mapping from scroll progress, time and drag to the stage state; testable in node), and `site/stage/stage.js` (three.js scene, DOM, scroll, drag, resize, fallbacks; verified by screenshots). `index.html` and `styles.css` are rewritten; the existing static SVG stays as the no-WebGL hero.

**Tech Stack:** HTML, CSS, vanilla JavaScript (ES modules), three.js 0.170.0 vendored, node 20+ built-in test runner (`node --test`) for the pure modules, headless Chrome for screenshots, Python 3 with numpy and Pillow for the existing `tools/` scripts.

**Spec:** `docs/superpowers/specs/2026-11-06-landing-page-redesign-design.md` (read it first; this plan argues from it). Reference prototype: `docs/superpowers/spikes/2026-11-06-scan-prototype.html` (throwaway; copy its physics and timing, not its page).

## Global Constraints

- Static site: `site/` is uploaded as is by `.github/workflows/deploy.yml` on every push to `main`. Work on a branch; merge only when the page is verified.
- No runtime CDN or third-party request. three.js and fonts are vendored under `site/vendor/` and `site/fonts/` with their licence files beside them.
- Never call Antaclis a company, startup, spin-off, project or team in the page copy; never mention legal status, founders, projects, partners, results or hardware. The only name is "Antaclis".
- Copy exactly as in the spec's "Copy" section unless the team replaces it. Sentence case, British spelling, no em-dashes, no exclamation marks, no "→" in link text, no uppercase eyebrow labels, no "01 / 02 / 03" numbering.
- Colours: background `#0D0F22`, text `#E8EAF2`, muted `#A2A8C0`, hairline `rgba(232,234,242,0.12)`, accent `#8AB6F9` (the only accent), ramp `#3458C8` → `#8AB6F9` → `#DCE9FF`, markers `#DCE9FF`. Dark only.
- Type: Schibsted Grotesk (variable, self-hosted) for headline and body; IBM Plex Mono (already in `site/fonts/`) for the readout, the email address and small labels. Body 17 px, line length under 70 characters.
- Email everywhere: `contact@antaclis.com`. URLs everywhere: `https://antaclis.com/`.
- Physics and timing values as pinned in the spec's "The simulation" section (room 500 × 500 × 300 cm; dipoles at (150, 350, 60) with moment (0, 0, 1.15) and at (350, 150, 150) with moment 9.2 along the unit vector of (1, −1, 0.5); seeds at 12 cm, polar angles 12°, 18°, 26°, 40°, 8 azimuths; RK4, 2 cm steps, ≤ 900 steps, stop within 9 cm of a dipole or at a wall; 28 slices, 96 × 58 textures; stages 0–0.16 draw, 0.16–0.62 sweep from x = −70 to 570, 0.62–0.72 hold, 0.72–1 infer; azimuth −0.55 → 0.45 rad, elevation 0.40 → 0.30 rad).
- Accessibility: semantic headings, skip link, visible focus, `prefers-reduced-motion` respected (ambient pulses and camera drift off; scroll and drag still work), text contrast ≥ 4.5:1, stage `aria-hidden`.
- Page weight under 1 MB transferred on first load (gzip sizes of everything the page requests).

## Review Focus

Inputs the spec implies but no feature test covers by itself. Each line's test is added to the task named.

1. Opening the page at `https://antaclis.com/#team` or `#contact` (a shared deep link): the stage must show its final state, not snap or animate from zero, and the sequence must not hijack the scroll. Test in Task 2 (`progressWithin` clamps to 1 beyond the sequence) and Task 4 (screenshot at `#contact`).
2. Resize or rotation mid-sequence (laptop window resized, phone rotated): the whole room must stay in view at any aspect ratio. Test in Task 2 (`cameraDistance(aspect)`), screenshot at 390 × 844 and 844 × 390 in Task 4.
3. Touch scroll taking over a drag (`pointercancel`): the drag must end cleanly, with no stuck "dragging" cursor and no runaway momentum. Test in Task 2 (`stepDrag` after `endDrag`) and Task 4 (manual on a phone or in device mode).
4. Very narrow screens (320 px): no horizontal scroll, the readout hides below 360 px. Screenshot at 320 × 568 in Task 3 and Task 4.
5. A browser without WebGL or with JavaScript disabled: the hero shows the static SVG, the captions read as ordinary sections with no empty 100 vh gaps. Test in Task 3 (page with no script) and Task 4 (Chrome with `--disable-gpu --disable-software-rasterizer`, or `?nowebgl=1`).

---

### Task 1: Field model (pure physics module)

**Files:**
- Create: `package.json` (root; `"type": "module"`, `"private": true`, `"scripts": {"test": "node --test tests/"}`; no dependencies)
- Create: `site/stage/model.js`
- Test: `tests/model.test.js`

**Interfaces:**
- Produces (all exported from `site/stage/model.js`; units cm and A m², field in arbitrary units with the µ0/4π factor dropped):
  - `ROOM: [number, number, number]` = `[500, 500, 300]`
  - `DIPOLES: Array<{position: [number, number, number], moment: [number, number, number]}>` as pinned in the spec, in that order (small one first).
  - `fieldAt(x, y, z, out = [0, 0, 0]): [number, number, number]` sum of dipole fields `(3 r (m·r)/r² − m)/r³`.
  - `magnitudeAt(x, y, z): number`.
  - `traceFieldLines(options = {}): Float32Array[]` one flat xyz array per line; defaults `seedRadius 12, polarDeg [12, 18, 26, 40], azimuths 8, step 2, maxSteps 900, stopRadius 9`; seeds at azimuth `(i + 0.5 · deg/12) · 2π/azimuths` as in the prototype; RK4 along the unit field; stops leaving the room or within `stopRadius` of any dipole after the first 5 steps; lines with fewer than 5 points are dropped.
  - `sliceSamples(x, width = 96, height = 58): Float32Array` log10 field magnitude on the plane of constant `x`, row `j` at `z = ROOM[2]·(j+0.5)/height`, column `i` at `y = ROOM[1]·(i+0.5)/width`, index `j·width + i`.
  - `logWindow(samples: ArrayLike<number>, lo = 0.25, hi = 0.997): {lo: number, hi: number}` the given quantiles of the sorted samples.

- [ ] **Step 1: Write the failing tests**

```js
// tests/model.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOM, DIPOLES, fieldAt, magnitudeAt, traceFieldLines, sliceSamples, logWindow } from "../site/stage/model.js";

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test("room and dipoles match the spec", () => {
  assert.deepEqual(ROOM, [500, 500, 300]);
  assert.deepEqual(DIPOLES[0].position, [150, 350, 60]);
  assert.deepEqual(DIPOLES[0].moment, [0, 0, 1.15]);
  assert.deepEqual(DIPOLES[1].position, [350, 150, 150]);
  assert.ok(Math.abs(Math.hypot(...DIPOLES[1].moment) - 9.2) < 1e-9);
  const u = [1, -1, 0.5].map((v) => v / Math.hypot(1, -1, 0.5));
  DIPOLES[1].moment.forEach((v, k) => assert.ok(Math.abs(v / 9.2 - u[k]) < 1e-12));
});

test("a single dipole is twice as strong on axis as on the equator", () => {
  // Far from the big magnet, the field of the small one dominates only if we
  // evaluate relative to its own centre at a tiny distance; use 1 cm.
  const [p] = DIPOLES.map((d) => d.position);
  const axial = magnitudeAt(p[0], p[1], p[2] + 1);
  const equatorial = magnitudeAt(p[0] + 1, p[1], p[2]);
  assert.ok(Math.abs(axial / equatorial - 2) < 0.01);
});

test("fieldAt writes into and returns the out array", () => {
  const out = [9, 9, 9];
  const r = fieldAt(10, 10, 10, out);
  assert.equal(r, out);
  assert.ok(out.every(Number.isFinite));
});

test("traceFieldLines returns 64 lines that start on the seed sphere and end at a dipole or a wall", () => {
  const lines = traceFieldLines();
  assert.equal(lines.length, 64);
  for (const line of lines) {
    assert.ok(line instanceof Float32Array);
    assert.ok(line.length >= 15 && line.length % 3 === 0);
    const first = [line[0], line[1], line[2]];
    const last = [line.at(-3), line.at(-2), line.at(-1)];
    assert.ok(DIPOLES.some((d) => Math.abs(dist(first, d.position) - 12) < 1e-3));
    const atDipole = DIPOLES.some((d) => dist(last, d.position) < 9 + 2);
    const atWall = [0, 1, 2].some((k) => last[k] < 2.5 || last[k] > ROOM[k] - 2.5);
    assert.ok(atDipole || atWall);
    for (let i = 3; i < line.length; i += 3) {
      const step = Math.hypot(line[i] - line[i - 3], line[i + 1] - line[i - 2], line[i + 2] - line[i - 1]);
      assert.ok(step < 2.05, "RK4 step length stays at 2 cm");
    }
  }
  assert.ok(lines.filter((l) => DIPOLES.some((d) => dist([l.at(-3), l.at(-2), l.at(-1)], d.position) < 11)).length >= 50);
});

test("sliceSamples is finite, indexed row-major and brightest near the big magnet", () => {
  const s = sliceSamples(350);
  assert.equal(s.length, 96 * 58);
  assert.ok(Array.from(s).every(Number.isFinite));
  let best = 0;
  for (let k = 1; k < s.length; k++) if (s[k] > s[best]) best = k;
  const i = best % 96, j = Math.floor(best / 96);
  const y = 500 * (i + 0.5) / 96, z = 300 * (j + 0.5) / 58;
  assert.ok(Math.hypot(y - 150, z - 150) < 8, "the maximum sits on the big magnet at (350, 150, 150)");
});

test("logWindow returns quantiles of the sorted samples", () => {
  const w = logWindow(Float32Array.from({ length: 1000 }, (_, k) => k));
  assert.equal(w.lo, 250);
  assert.equal(w.hi, 997);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../site/stage/model.js'`

- [ ] **Step 3: Create `package.json` and implement `site/stage/model.js`**

Port `fieldAt`, `traceLines`, `fillSlice` and the quantile window from the prototype into the exported functions above. Keep the module free of DOM and three.js imports.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add package.json site/stage/model.js tests/model.test.js
git commit -m "feat(stage): field model with dipole field, line tracing and slice sampling"
```

---

### Task 2: Sequence state (pure scroll, time and drag mapping)

**Files:**
- Create: `site/stage/sequence.js`
- Test: `tests/sequence.test.js`

**Interfaces:**
- Consumes: `ROOM` from `model.js` for the sweep range.
- Produces (exported from `site/stage/sequence.js`):
  - `STAGES = { draw: [0, 0.16], sweep: [0.16, 0.62], hold: [0.62, 0.72], infer: [0.72, 1] }`
  - `NSLICES = 28`, `SLICE_X: number[]` = `(i + 0.5) · 500 / 28`.
  - `sequenceState(p, { time = 0, reducedMotion = false } = {}): State` with
    `State = { draw, sweepX, planeOpacity, restore, sliceOpacity: number[28], ringReveal, converge, settle, azimuth, elevation, pulsesOn: boolean }`, all numbers in [0, 1] except `sweepX` (cm) and the angles (rad). Formulas and stagger exactly as in the prototype's `applyState`, with the ambient `0.08 · sin(0.15 · time)` azimuth wobble only when `reducedMotion` is false.
  - `colourRamp(t): [r, g, b, a]` bytes 0–255; the four-stop ramp of the prototype (`[0.04,0.06,0.16,0]`, `[0.20,0.35,0.78,0.55]`, `[0.54,0.71,0.98,0.85]`, `[0.92,0.95,1,1]`) with `a = 255 · 0.95 · t^1.3`.
  - `cameraDistance(aspect, infer): number` = `max(lerp(840, 760, infer), 1180 / aspect)`.
  - `progressWithin(scrollTop, sequenceTop, sequenceHeight, viewportHeight): number` = clamp of `(scrollTop − sequenceTop) / (sequenceHeight − viewportHeight)` to [0, 1].
  - `createDrag(): Drag` and `dragStart(drag, x, y)`, `dragMove(drag, x, y, width)`, `dragEnd(drag)`, `stepDrag(drag, dt, elevationBase): void` implementing the prototype's momentum (velocity scaled by 12 per second, damping `exp(−1.4·dt)`, cut off below 1e-5) and the elevation clamp to [−0.2, 1.35] which zeroes `vEl` when hit. `Drag = { az, el, vAz, vEl, active }`.
  - `readoutText(p, state): string` the two-line readout of the prototype (`field lines · 2 sources` / `scan · x = … cm · slice … / 28` / `data · 28 slices · 155904 readings` / `inference · … %`, second line `room 500 × 500 × 300 cm`).

- [ ] **Step 1: Write the failing tests**

```js
// tests/sequence.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES, NSLICES, SLICE_X, sequenceState, colourRamp, cameraDistance, progressWithin,
         createDrag, dragStart, dragMove, dragEnd, stepDrag, readoutText } from "../site/stage/sequence.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("stage boundaries and slice positions follow the spec", () => {
  assert.deepEqual(STAGES, { draw: [0, 0.16], sweep: [0.16, 0.62], hold: [0.62, 0.72], infer: [0.72, 1] });
  assert.equal(NSLICES, 28);
  near(SLICE_X[0], 250 / 28); near(SLICE_X[27], 500 - 250 / 28);
});

test("lines draw in over the first stage and the plane is hidden", () => {
  assert.equal(sequenceState(0).draw, 0);
  assert.equal(sequenceState(0.16).draw, 1);
  assert.equal(sequenceState(0.1).planeOpacity, 0);
  assert.ok(sequenceState(0.1).sliceOpacity.every((o) => o === 0));
});

test("the sweep runs from x = -70 to 570 and leaves slices behind", () => {
  near(sequenceState(0.16).sweepX, -70);
  near(sequenceState(0.62).sweepX, 570);
  const mid = sequenceState(0.39);
  near(mid.sweepX, 250, 1e-9);
  assert.ok(mid.planeOpacity > 0.8);
  assert.ok(mid.sliceOpacity[0] > 0.8, "first slice recorded");
  assert.equal(mid.sliceOpacity[27], 0, "last slice not yet recorded");
  assert.ok(sequenceState(0.65).sliceOpacity.every((o) => o > 0.8), "all slices held");
  assert.equal(sequenceState(0.65).planeOpacity, 0);
});

test("inference dissolves the slices, tightens the rings and settles the markers", () => {
  const end = sequenceState(1);
  assert.ok(end.sliceOpacity.every((o) => o === 0));
  assert.equal(end.ringReveal, 1); assert.equal(end.converge, 1); assert.equal(end.settle, 1);
  near(end.restore, 0.85);
  const early = sequenceState(0.80);
  assert.ok(early.ringReveal > 0 && early.settle === 0, "rings appear before the arrow");
  assert.ok(early.sliceOpacity[0] < early.sliceOpacity[13], "walls dissolve before the centre");
});

test("camera orbits across the sequence and holds still under reduced motion", () => {
  near(sequenceState(0).azimuth, -0.55); near(sequenceState(1).azimuth, 0.45);
  near(sequenceState(0).elevation, 0.40); near(sequenceState(1).elevation, 0.30);
  const a = sequenceState(0.5, { time: 3 }), b = sequenceState(0.5, { time: 9 });
  assert.notEqual(a.azimuth, b.azimuth);
  const c = sequenceState(0.5, { time: 3, reducedMotion: true }), d = sequenceState(0.5, { time: 9, reducedMotion: true });
  assert.equal(c.azimuth, d.azimuth);
  assert.equal(c.pulsesOn, false); assert.equal(a.pulsesOn, true);
});

test("colour ramp is transparent at zero and near white at one", () => {
  assert.deepEqual(colourRamp(0), [10, 15, 41, 0]);
  const top = colourRamp(1);
  assert.ok(top[0] >= 230 && top[1] >= 240 && top[2] === 255 && top[3] === 242);
});

test("camera distance keeps the room in view at any aspect ratio", () => {
  near(cameraDistance(2, 0), 840);
  near(cameraDistance(0.5, 0), 2360);
  near(cameraDistance(1.8, 1), 760);
});

test("progress within the sequence clamps on both sides", () => {
  assert.equal(progressWithin(0, 0, 5000, 900), 0);
  assert.equal(progressWithin(-200, 0, 5000, 900), 0);
  near(progressWithin(2050, 0, 5000, 900), 0.5);
  assert.equal(progressWithin(9000, 0, 5000, 900), 1, "deep links past the sequence show the final state");
});

test("drag has momentum, friction, an elevation clamp and a clean end", () => {
  const d = createDrag();
  dragStart(d, 100, 100); dragMove(d, 160, 100, 1200); assert.ok(d.az < 0 && d.active);
  dragEnd(d);
  const before = d.az;
  stepDrag(d, 0.1, 0.4); assert.ok(d.az < before, "keeps turning after release");
  for (let i = 0; i < 100; i++) stepDrag(d, 0.1, 0.4);
  assert.equal(d.vAz, 0, "friction stops it");
  dragStart(d, 0, 0); dragMove(d, 0, 5000, 1200); dragEnd(d); stepDrag(d, 0.016, 0.4);
  near(0.4 + d.el, 1.35, 1e-9); assert.equal(d.vEl, 0, "clamped at the pole");
  dragStart(d, 0, 0); dragMove(d, 50, 0, 1200); dragEnd(d);
  assert.equal(d.active, false);
});

test("readout text names the stage in real units", () => {
  assert.match(readoutText(0.05, sequenceState(0.05)), /^field lines · 2 sources\nroom 500 × 500 × 300 cm$/);
  assert.match(readoutText(0.39, sequenceState(0.39)), /^scan · x = 250 cm · slice 14 \/ 28\n/);
  assert.match(readoutText(0.65, sequenceState(0.65)), /^data · 28 slices · 155904 readings\n/);
  assert.match(readoutText(1, sequenceState(1)), /^inference · 100 %\n/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../site/stage/sequence.js'`

- [ ] **Step 3: Implement `site/stage/sequence.js`**

Port `applyState`, the drag handlers, the momentum block and the HUD string from the prototype into the pure functions above. `sequenceState` must not read the DOM or the clock; `time` comes in as an argument.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 16 tests

- [ ] **Step 5: Commit**

```bash
git add site/stage/sequence.js tests/sequence.test.js
git commit -m "feat(stage): pure sequence state, drag momentum and readout"
```

---

### Task 3: Page markup, styles, fonts and content guards

**Files:**
- Modify: `site/index.html` (rewrite)
- Modify: `site/styles.css` (rewrite)
- Create: `site/CNAME` (one line: `antaclis.com`)
- Create: `site/fonts/schibsted-grotesk-latin-wght.woff2`, `site/fonts/LICENSE-Schibsted-Grotesk.txt`
- Delete: `site/fonts/inter-latin-wght.woff2`, `site/fonts/LICENSE-Inter.txt`, `site/field.js`
- Test: `tests/content.test.js`

**Interfaces:**
- Produces the DOM contract that Task 4 relies on:
  - `<section class="sequence" id="sequence">` containing, in order, `<div class="stage" id="stage" aria-hidden="true">` with `<canvas id="stage-canvas">`, `<div class="scrim">`, `<p class="readout" id="readout" hidden>` and `<p class="drag-hint" id="drag-hint" hidden>drag to rotate</p>`; then `<div class="beats">` with four `<div class="beat">` blocks (classes `beat-hero`, `beat-measure`, `beat-infer`, `beat-landing`), each with one `<div class="caption">`.
  - The hero caption holds the existing `<svg class="field">` with its `FIELD-LINES` markers (the no-WebGL hero) and `data-fallback` attribute.
  - `stage.js` adds the class `has-stage` to `<html>` once WebGL is up; CSS hides `svg.field` and shows the readout and drag hint only under `.has-stage`, and under `:root:not(.has-stage)` the beats collapse to normal flow (`min-height: auto`, no sticky stage).
  - Section ids `work`, `team`, `contact` for the nav; `main` id for the skip link.
- Layout rule for the sequence: `.stage { position: sticky; top: 0; height: 100vh }`, `.beats { position: relative; margin-top: -100vh }`, beat heights hero 100vh, measure 180vh, infer 160vh, landing 80vh (tune so that the "Measure." caption is in view when the sweep starts at p = 0.16 and "Infer." when inference starts at p = 0.72); captions `position: sticky; top: 28vh` inside each beat, left column `max-width: 30rem`, `pointer-events: none` on `.beats` and `auto` on `.caption`.
- Scrim: `.scrim` absolutely fills the stage; on screens wider than 56 rem a horizontal gradient from `var(--bg)` at 0 % to 85 % opacity at 24 % to transparent at 55 %; below, a vertical gradient from `var(--bg)` at the top 35 % to transparent at 70 %.

- [ ] **Step 1: Write the failing content tests**

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/content.test.js` (or `node --test tests/content.test.js`)
Expected: FAIL on forbidden words (`registered`, `gmail.com`), missing CNAME, missing copy

- [ ] **Step 3: Vendor the font**

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
URL=$(curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400..900&display=swap" \
      | sed -n '/\/\* latin \*\//,$p' | grep -o 'https[^)]*' | head -1)
curl -s "$URL" -o site/fonts/schibsted-grotesk-latin-wght.woff2
curl -s https://raw.githubusercontent.com/google/fonts/main/ofl/schibstedgrotesk/OFL.txt -o site/fonts/LICENSE-Schibsted-Grotesk.txt
git rm -q site/fonts/inter-latin-wght.woff2 site/fonts/LICENSE-Inter.txt site/field.js
```

Check: `file site/fonts/schibsted-grotesk-latin-wght.woff2` reports `Web Open Font Format (Version 2)` and the file is under 60 KB.

- [ ] **Step 4: Rewrite `site/index.html`**

Keep the head's icon and Open Graph structure, update every URL and description to the spec's values, drop the `color-scheme` meta and the light `theme-color`. Body in this order: skip link; header (logo mark, wordmark, nav "What we do", "Team", "Contact"); `<main id="main">` with the `sequence` section (DOM contract above, copy from the spec's four beats, the fallback SVG inside the hero caption); section `work` ("What we do": statement plus a two-by-two grid of four titled paragraphs); section `team` (the four existing people, keep the "each person approves their own line" comment); section `contact` (statement, button "Write to contact@antaclis.com", the address as selectable mono text); footer "© 2026 Antaclis"; `<script type="module" src="stage/stage.js"></script>` last.

- [ ] **Step 5: Rewrite `site/styles.css`**

Sections: fonts (`@font-face` for Schibsted Grotesk 400–900 and the two IBM Plex Mono files), tokens (the Global Constraints colours, `--font-text`, `--font-mono`, type scale with h1 `clamp(2.75rem, 1.4rem + 6vw, 5.5rem)` at weight 500 and letter-spacing −0.03em, body 17 px), base, header, sequence layout and scrim (Interfaces above), readout and drag hint (mono, 0.75 rem, muted, bottom corners, hidden below 360 px), sections and hairlines, work grid, team, contact button, footer, `prefers-reduced-motion` (no transitions), focus rings in the accent. No light-mode block, no numbered labels, no uppercase labels.

- [ ] **Step 6: Run the content tests**

Run: `npm test`
Expected: PASS, all tests

- [ ] **Step 7: Screenshot the page without the stage**

```bash
(cd site && python3 -m http.server 8000 >/dev/null 2>&1 &)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for size in 1440,900 390,844 320,568; do
  "$CHROME" --headless=new --hide-scrollbars --virtual-time-budget=3000 --window-size=$size --screenshot=/tmp/nostage-$size.png "http://localhost:8000/?nowebgl=1"
done
```

(`?nowebgl=1` is honoured by Task 4; until then the stage script does not exist and the page renders the same fallback.) Look at each image: the static SVG hero shows, no empty viewport-high gaps between captions, no horizontal scroll at 320 px, text column under 70 characters, fonts rendered (headline visibly not a system sans).

- [ ] **Step 8: Commit**

```bash
git add site/index.html site/styles.css site/CNAME site/fonts tests/content.test.js
git commit -m "feat(site): new page structure, copy, dark-only styles, self-hosted Schibsted Grotesk"
```

---

### Task 4: WebGL stage (three.js scene, scroll, drag, fallbacks)

**Files:**
- Create: `site/vendor/three.module.min.js`, `site/vendor/LICENSE-three.txt`
- Create: `site/stage/stage.js`
- Modify: `site/styles.css` (only if a screenshot shows the scrim or composition needs tuning)

**Interfaces:**
- Consumes: everything exported by `model.js` and `sequence.js` (Tasks 1 and 2), the DOM contract of Task 3.
- Produces: `site/stage/stage.js`, an ES module with no exports that, on load:
  1. Returns silently if `document.getElementById("stage-canvas")` is missing, if `location.search` contains `nowebgl=1`, or if `WebGLRenderer` construction throws. In those cases `<html>` never gets `has-stage` and the fallback SVG stays.
  2. Otherwise adds `has-stage` to `<html>`, un-hides `#readout` and `#drag-hint` (the hint hides itself after the first drag or after 8 s).
  3. Builds the scene as in the prototype, reading geometry from `traceFieldLines()`, slice textures from `sliceSamples` + `logWindow` + `colourRamp`, and all per-frame values from `sequenceState`, `cameraDistance` and the drag functions. Line shader, slice meshes, scanning plane with live texture and outline, room edges, marker groups (rings, arrow, core) as in the prototype.
  4. Progress: `progressWithin(window.scrollY, sequenceTop, sequenceHeight, innerHeight)` where `sequenceTop` is `#sequence`'s offset from the document top (recomputed on resize); displayed progress eases toward it at rate 7/s as in the prototype.
  5. Look-at target: room centre, shifted along the camera's right vector by `0.18 · cameraDistance · tan(fov/2) · aspect` when the viewport is wider than 56 rem (896 px), so the room sits right of the text column; centred otherwise.
  6. `prefers-reduced-motion: reduce` passes `reducedMotion: true` to `sequenceState` and disables the pulse term in the line shader.
  7. Renders only while `#stage` intersects the viewport (IntersectionObserver), pixel ratio capped at 2, resize via ResizeObserver on the canvas.
  8. Debug hook for screenshots: `?p=0.45` scrolls the window to the matching position on load and sets displayed progress immediately (no easing).

- [ ] **Step 1: Vendor three.js**

```bash
mkdir -p site/vendor
curl -s https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js -o site/vendor/three.module.min.js
curl -s https://cdn.jsdelivr.net/npm/three@0.170.0/LICENSE -o site/vendor/LICENSE-three.txt
head -c 200 site/vendor/LICENSE-three.txt   # must read "MIT License"
```

- [ ] **Step 2: Write `site/stage/stage.js`**

`import * as THREE from "../vendor/three.module.min.js";` then the behaviour in Interfaces. Port the prototype's scene code; replace every inline formula with the Task 1 and Task 2 functions (no physics or timing constants may live in `stage.js`). Comment the file in the spirit of the old `field.js` header.

- [ ] **Step 3: Screenshot the sequence at desktop and phone sizes**

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for size in 1440,900 390,844 844,390 320,568; do for p in 0 0.10 0.39 0.66 0.80 1; do
  "$CHROME" --headless=new --hide-scrollbars --virtual-time-budget=4000 --window-size=$size --screenshot=/tmp/stage-$size-$p.png "http://localhost:8000/?p=$p"
done; done
"$CHROME" --headless=new --hide-scrollbars --virtual-time-budget=4000 --window-size=1440,900 --screenshot=/tmp/stage-contact.png "http://localhost:8000/#contact"
"$CHROME" --headless=new --hide-scrollbars --virtual-time-budget=4000 --window-size=1440,900 --screenshot=/tmp/stage-nowebgl.png "http://localhost:8000/?nowebgl=1"
```

If headless Chrome renders a blank stage, add `--use-angle=swiftshader --enable-unsafe-swiftshader` and retry. Check each image against the spec: p = 0 lines drawing in, no sources visible; 0.39 plane mid-room with slices behind it and lines dimmed behind; 0.66 only data, no plane; 0.80 rings visible, no arrows; 1 arrows, cores, lines restored, no slices. Desktop: room right of the text, caption text over the scrim fully legible. Phone: whole room in view, readout visible at 390 and hidden at 320, no horizontal scroll. `#contact`: final stage state with the contact section in view. `nowebgl`: fallback SVG, no empty gaps. Record the paths of the screenshots in the commit message body.

- [ ] **Step 4: Check the console and the page weight**

```bash
"$CHROME" --headless=new --enable-logging=stderr --v=0 --window-size=1440,900 --screenshot=/tmp/x.png "http://localhost:8000/?p=0.5" 2>&1 | grep -iE "error|warning" ; echo "exit: no errors expected"
for f in site/index.html site/styles.css site/stage/*.js site/vendor/three.module.min.js site/fonts/*.woff2 site/assets/logo-mark-dark.png; do gzip -c "$f" | wc -c; done | awk '{s+=$1} END {print s " bytes gzipped"}'
```

Expected: no `Uncaught` or shader compile errors; total under 1,000,000 bytes.

- [ ] **Step 5: Run the whole test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add site/vendor site/stage/stage.js site/styles.css
git commit -m "feat(stage): scroll-driven field scan with drag rotation and fallbacks"
```

---

### Task 5: Tools, social preview and documentation

**Files:**
- Modify: `tools/og.html` (fonts to Schibsted Grotesk, remove the "Early-stage research project" label, replace it with the spec's hero lead in muted text at 22 px)
- Modify: `tools/README.md` (drop the `field.js` row, add rows for `site/stage/*.js` and `npm test`, note the `?p=` and `?nowebgl=1` hooks)
- Modify: `site/assets/og.png` (regenerated)
- Modify: `README.md` (one paragraph: what the site is, where it deploys, how to test)
- Test: `tests/content.test.js` (extend)

- [ ] **Step 1: Extend the content test**

```js
test("the social preview source matches the page", () => {
  const og = readFileSync("tools/og.html", "utf8");
  assert.ok(!/early-stage|research project|Inter/i.test(og));
  assert.ok(og.includes("Seeing through"));
  assert.ok(og.includes("schibsted-grotesk-latin-wght.woff2"));
});
```

Run: `npm test` — Expected: FAIL on `Inter` and `Early-stage`.

- [ ] **Step 2: Update `tools/og.html` and regenerate the image**

```bash
"$CHROME" --headless=new --hide-scrollbars --virtual-time-budget=2000 --window-size=1200,630 --screenshot=site/assets/og.png "file://$PWD/tools/og.html"
python3 tools/fieldlines.py   # must still find both FIELD-LINES blocks and exit 0
git diff --stat site/index.html tools/og.html   # fieldlines.py should change nothing but the SVG paths, if anything
```

Look at `site/assets/og.png`: wordmark, headline, lead, field lines, nothing about status.

- [ ] **Step 3: Update `tools/README.md` and `README.md`**

- [ ] **Step 4: Run the tests**

Run: `npm test` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/og.html tools/README.md README.md site/assets/og.png tests/content.test.js
git commit -m "chore: social preview, tools docs and readme for the redesign"
```

---

### Task 6: Final verification and merge

- [ ] **Step 1: Keyboard and screen-reader pass in a real browser**

Open `http://localhost:8000/`. Tab from the top: the skip link appears first, every link and the button show the accent focus ring, the stage never takes focus. With VoiceOver (or the browser's accessibility tree), the headings read Antaclis → Seeing through fields → Measure → Infer → That is Antaclis → What we do → Team → Contact, and the canvas is not announced.

- [ ] **Step 2: Reduced motion and touch**

In Chrome DevTools, Rendering → emulate `prefers-reduced-motion: reduce`: pulses stop, the camera stops drifting, scrolling still drives the sequence and dragging still rotates. Device mode (iPhone): vertical swipe scrolls, horizontal swipe rotates, a flick keeps turning and stops within a few seconds, cursor state never sticks.

- [ ] **Step 3: Merge and deploy**

```bash
git checkout main && git merge --no-ff <branch> -m "Landing page redesign"
git push origin main
```

Wait for the "Deploy to GitHub Pages" workflow, then open `https://antaclis.com/` and `https://antaclis.com/#contact` on a laptop and a phone. Confirm "Enforce HTTPS" is on in the repository's Pages settings and that `https://antaclis.github.io/` redirects to `https://antaclis.com/`.
