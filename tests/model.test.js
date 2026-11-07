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
