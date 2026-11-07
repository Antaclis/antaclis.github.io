// Field model: two permanent magnets (point dipoles) in a 5 x 5 x 3 m room.
// Pure physics, no DOM and no three.js, so it can run in a test or a worker.
//
// Units: positions in cm, magnetic moments in A m^2. The field is in arbitrary
// units: the constant mu0/4pi is dropped, only the shape and ratios matter.

/** Room size [x, y, z] in cm. The origin is one corner on the floor. */
export const ROOM = [500, 500, 300];

const unit = (v) => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const tilt = unit([1, -1, 0.5]);

/** The two sources, small one first: 1 cm^3 of N52 pointing up, 8 cm^3 tilted. */
export const DIPOLES = [
  { position: [150, 350, 60], moment: [0, 0, 1.15] },
  { position: [350, 150, 150], moment: [9.2 * tilt[0], 9.2 * tilt[1], 9.2 * tilt[2]] },
];

/**
 * Field of all dipoles at (x, y, z): sum of (3 r (m.r)/r^2 - m) / r^3.
 * Writes into `out` and returns it as [Bx, By, Bz].
 */
export function fieldAt(x, y, z, out = [0, 0, 0]) {
  out[0] = out[1] = out[2] = 0;
  for (const { position: p, moment: m } of DIPOLES) {
    const rx = x - p[0], ry = y - p[1], rz = z - p[2];
    const r2 = rx * rx + ry * ry + rz * rz;
    if (r2 < 1e-6) continue; // exactly on a dipole: skip the singularity
    const inv3 = 1 / (r2 * Math.sqrt(r2));
    const k = (3 * (m[0] * rx + m[1] * ry + m[2] * rz)) / r2;
    out[0] += (k * rx - m[0]) * inv3;
    out[1] += (k * ry - m[1]) * inv3;
    out[2] += (k * rz - m[2]) * inv3;
  }
  return out;
}

/** Field strength |B| at (x, y, z). */
export function magnitudeAt(x, y, z) {
  const b = fieldAt(x, y, z);
  return Math.hypot(b[0], b[1], b[2]);
}

/**
 * Field lines, traced with RK4 along the unit field vector (fixed step length).
 * Seeds sit on a small sphere around each dipole, at several polar angles from
 * its axis and evenly spaced in azimuth. A line ends when it leaves the room or
 * comes within `stopRadius` of a dipole (after the first few steps).
 * Returns one flat [x0, y0, z0, x1, ...] Float32Array per line, in cm.
 */
export function traceFieldLines({
  seedRadius = 12,
  polarDeg = [12, 18, 26, 40],
  azimuths = 8,
  step = 2,
  maxSteps = 900,
  stopRadius = 9,
} = {}) {
  const inRoom = (q) => q[0] > 0 && q[0] < ROOM[0] && q[1] > 0 && q[1] < ROOM[1] && q[2] > 0 && q[2] < ROOM[2];
  const nearDipole = (q) =>
    DIPOLES.some(({ position: p }) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < stopRadius);
  const dir = (q) => {
    const b = fieldAt(q[0], q[1], q[2]);
    const n = Math.hypot(b[0], b[1], b[2]) || 1;
    return [b[0] / n, b[1] / n, b[2] / n];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const advance = (q, k, h) => [q[0] + h * k[0], q[1] + h * k[1], q[2] + h * k[2]];

  const lines = [];
  for (const { position: p, moment } of DIPOLES) {
    // Orthonormal frame (u, v, w) with u along the moment.
    const u = unit(moment);
    const v = unit(cross(u, Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const w = cross(u, v);
    for (const deg of polarDeg) {
      const th = (deg * Math.PI) / 180;
      for (let i = 0; i < azimuths; i++) {
        // Azimuth offset grows with the polar angle so the rings do not line up.
        const ph = ((i + 0.5 * (deg / 12)) * 2 * Math.PI) / azimuths;
        const c = Math.cos(th), s = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
        let q = [0, 1, 2].map((k) => p[k] + seedRadius * (c * u[k] + s * (cp * v[k] + sp * w[k])));
        const pts = [q[0], q[1], q[2]];
        for (let n = 0; n < maxSteps; n++) {
          const k1 = dir(q);
          const k2 = dir(advance(q, k1, step / 2));
          const k3 = dir(advance(q, k2, step / 2));
          const k4 = dir(advance(q, k3, step));
          q = [0, 1, 2].map((k) => q[k] + (step * (k1[k] + 2 * k2[k] + 2 * k3[k] + k4[k])) / 6);
          if (!inRoom(q)) break;
          pts.push(q[0], q[1], q[2]);
          if (n >= 5 && nearDipole(q)) break;
        }
        if (pts.length >= 15) lines.push(Float32Array.from(pts)); // at least 5 points
      }
    }
  }
  return lines;
}

/**
 * log10 of the field strength on the plane of constant x, sampled at cell
 * centres: column i at y = ROOM[1] (i + 0.5) / width, row j at
 * z = ROOM[2] (j + 0.5) / height, stored at index j * width + i.
 */
export function sliceSamples(x, width = 96, height = 58) {
  const out = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    const z = (ROOM[2] * (j + 0.5)) / height;
    for (let i = 0; i < width; i++) {
      out[j * width + i] = Math.log10(magnitudeAt(x, (ROOM[1] * (i + 0.5)) / width, z) + 1e-12);
    }
  }
  return out;
}

/**
 * Colour window for the slices: the `lo` and `hi` quantiles of the samples.
 * Values below lo fade out, values above hi saturate.
 */
export function logWindow(samples, lo = 0.25, hi = 0.997) {
  const sorted = Float64Array.from(samples).sort();
  const at = (f) => sorted[Math.floor(sorted.length * f)];
  return { lo: at(lo), hi: at(hi) };
}

/**
 * Whether a traced line ends at a dipole (it came back to a source) rather
 * than at a wall: its last point lies within `radius` cm of some dipole.
 */
export function closesAtSource(pts, radius = 12) {
  const n = pts.length;
  const x = pts[n - 3], y = pts[n - 2], z = pts[n - 1];
  return DIPOLES.some(({ position: p }) => Math.hypot(x - p[0], y - p[1], z - p[2]) < radius);
}

/**
 * Where the planes of constant x in `xs` cross the lines: one reading per
 * crossing, interpolated between the two points of the segment that straddles
 * the plane. Returns flat arrays: `pos` [x, y, z, ...] in cm, `t` the position
 * along the line (0 at its seed, 1 at its end), `line` the index of the line.
 */
export function sliceCrossings(lines, xs) {
  const pos = [], t = [], line = [];
  lines.forEach((pts, li) => {
    const n = pts.length / 3;
    for (let i = 0; i < n - 1; i++) {
      const x0 = pts[3 * i], x1 = pts[3 * i + 3];
      if (x0 === x1) continue;
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      for (const x of xs) {
        if (x < lo || x >= hi) continue;
        const f = (x - x0) / (x1 - x0);
        pos.push(x, pts[3 * i + 1] + f * (pts[3 * i + 4] - pts[3 * i + 1]), pts[3 * i + 2] + f * (pts[3 * i + 5] - pts[3 * i + 2]));
        t.push((i + f) / (n - 1));
        line.push(li);
      }
    }
  });
  return { pos: Float32Array.from(pos), t: Float32Array.from(t), line: Uint16Array.from(line) };
}
