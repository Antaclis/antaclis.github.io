"""Compute the hero field-line illustration and inject it into the HTML.

The picture is the real magnetic field of a few point dipoles lying in one
plane, B = sum_k (3(m_k.r)r/|r|^5 - m_k/|r|^3), traced as field lines with
4th-order Runge-Kutta. The dipoles themselves are not drawn: only their field
is visible, which is the idea behind the site.

Output replaces everything between the FIELD-LINES markers in
site/index.html, so the page itself needs no JavaScript (tools/og.js reuses them).

Run from the repo root:   python tools/fieldlines.py            (inject)
                          python tools/fieldlines.py preview.png (raster preview only)
"""
import re
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
TARGETS = [ROOT / "site" / "index.html"]  # tools/og.js reads the lines from here

W, H = 640, 500      # SVG viewBox
MARGIN = 80          # lines are traced this far outside the viewBox, then clipped
STEP = 1.0           # integration step, in viewBox units

# (x, y, strength, direction in degrees; 0 = right, 90 = up). Hidden sources.
DIPOLES = [
    (300, 250, 1.00, 82),
    (500, 370, 0.06, 30),
]
# Size parameter L of the seeded field lines around each dipole (r = L sin^2 theta).
# The second dipole gets no lines of its own: it only shows by bending the others.
LOOPS = {
    0: [34 * 1.33 ** k for k in range(10)],
    1: [],
}

POS = np.array([[x, y] for x, y, _, _ in DIPOLES], float)
MOM = np.array([[s * np.cos(np.radians(a)), -s * np.sin(np.radians(a))]  # SVG y points down
                for _, _, s, a in DIPOLES])


def field(p):
    r = p - POS
    d = np.linalg.norm(r, axis=1)
    mr = np.einsum("ij,ij->i", MOM, r)
    return (3 * mr[:, None] * r / d[:, None] ** 5 - MOM / d[:, None] ** 3).sum(axis=0)


def direction(p):
    b = field(p)
    return b / np.linalg.norm(b)


def trace(p, sign=1, max_len=5000):
    """Follow the field from p (sign=1) or against it (sign=-1) until it leaves or ends."""
    pts = [p.copy()]
    f = lambda q: sign * direction(q)
    for _ in range(int(max_len / STEP)):
        k1 = f(p)
        k2 = f(p + 0.5 * STEP * k1)
        k3 = f(p + 0.5 * STEP * k2)
        k4 = f(p + STEP * k3)
        p = p + STEP / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        pts.append(p.copy())
        if not (-MARGIN < p[0] < W + MARGIN and -MARGIN < p[1] < H + MARGIN):
            break
        if (np.linalg.norm(POS - p, axis=1) < 4).any():  # arrived at a south pole
            break
    return np.array(pts)


def simplify(pts, tol=0.25):
    """Ramer-Douglas-Peucker polyline simplification."""
    keep = np.zeros(len(pts), bool)
    keep[[0, -1]] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        ab = b - a
        n = np.linalg.norm(ab) or 1.0
        seg = pts[i + 1:j] - a
        dist = np.abs(ab[0] * seg[:, 1] - ab[1] * seg[:, 0]) / n
        k = int(np.argmax(dist))
        if dist[k] > tol:
            keep[i + 1 + k] = True
            stack += [(i, i + 1 + k), (i + 1 + k, j)]
    return pts[keep]


def lines():
    out = []
    for k, loops in LOOPS.items():
        m_hat = MOM[k] / np.linalg.norm(MOM[k])
        start_r = 4.0
        if k == 0:  # the axis line, out of both poles
            out.append(trace(POS[k] + start_r * m_hat))
            out.append(trace(POS[k] - start_r * m_hat, sign=-1))
        for L in loops:
            theta = np.arcsin(np.sqrt(start_r / L))
            for sign in (1, -1):
                c, s = np.cos(sign * theta), np.sin(sign * theta)
                d = np.array([c * m_hat[0] - s * m_hat[1], s * m_hat[0] + c * m_hat[1]])
                out.append(trace(POS[k] + start_r * d))
    return [simplify(l) for l in out if len(l) > 10]


def to_path(pts):
    d = [f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"]
    d += [f"l{dx:.1f} {dy:.1f}" for dx, dy in np.diff(pts, axis=0)]
    return "".join(d).replace(" -", "-")


def svg_group(ls):
    rows = [f'<path d="{to_path(l)}" pathLength="1" style="--i:{i}"/>' for i, l in enumerate(ls)]
    return "\n".join(rows)


def inject(markup):
    for target in TARGETS:
        if not target.exists():
            continue
        html = target.read_text(encoding="utf-8")
        new, n = re.subn(r"(<!-- FIELD-LINES:START -->).*?(<!-- FIELD-LINES:END -->)",
                         lambda m: f"{m.group(1)}\n{markup}\n{m.group(2)}", html, flags=re.S)
        if n:
            target.write_text(new, encoding="utf-8")
            print(f"injected {len(markup) // 1024} KB into {target.relative_to(ROOT)}")


def preview(ls, path):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (W * 2, H * 2), (13, 15, 34))
    dr = ImageDraw.Draw(im)
    for l in ls:
        dr.line([tuple(p * 2) for p in l], fill=(138, 182, 249), width=2)
    dr.rectangle([0, 0, W * 2 - 1, H * 2 - 1], outline=(60, 60, 90))
    im.save(path)


if __name__ == "__main__":
    ls = lines()
    print(len(ls), "lines,", sum(len(l) for l in ls), "points")
    if len(sys.argv) > 1:
        preview(ls, sys.argv[1])
    else:
        inject(svg_group(ls))
