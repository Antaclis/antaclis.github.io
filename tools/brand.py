"""Generate the logo variants and favicons used by the site.

Source: ../a-logo-white.png (1024x1024, navy + light blue on a white background).
The shape and colours are not changed. The script only:
  1. removes the white background (each pixel is "un-mixed" from white, so
     anti-aliased edges stay smooth on any background);
  2. makes a dark-mode copy in which the navy parts become near-white;
  3. builds favicons (light mark on a navy rounded square, readable on any tab).

Run from the repo root:  python tools/brand.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "a-logo-white.png"
OUT = ROOT / "site" / "assets"

NAVY = np.array([26, 28, 58], float)     # logo navy  #1A1C3A
BLUE = np.array([138, 182, 249], float)  # logo blue  #8AB6F9
INK_DARK_MODE = np.array([232, 234, 242], float)  # replaces navy in dark mode, = --text in styles.css
TILE = (13, 15, 34)                      # favicon background, = dark --bg in styles.css


def unmix(rgb):
    """Return (alpha, is_blue) for every pixel, assuming pixel = a*colour + (1-a)*white."""
    d = 255.0 - rgb
    best_a, best_err, is_blue = None, None, None
    for i, colour in enumerate((NAVY, BLUE)):
        c = 255.0 - colour
        a = np.clip((d @ c) / (c @ c), 0, 1)
        err = np.linalg.norm(d - a[..., None] * c, axis=-1)
        if best_a is None:
            best_a, best_err, is_blue = a, err, np.zeros_like(a, bool)
        else:
            pick = err < best_err
            best_a = np.where(pick, a, best_a)
            is_blue = pick
    return best_a, is_blue


def render(alpha, is_blue, ink):
    rgb = np.where(is_blue[..., None], BLUE, ink)
    rgba = np.dstack([rgb, alpha * 255]).round().astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def square_crop(img, pad=0.04):
    """Crop to the visible content and pad back to a square."""
    l, t, r, b = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    side = int(max(r - l, b - t) * (1 + 2 * pad))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img.crop((l, t, r, b)), ((side - (r - l)) // 2, (side - (b - t)) // 2))
    return canvas


def favicon(mark_light, size, radius=0.22, inset=0.14):
    tile = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle(
        [0, 0, size * 4 - 1, size * 4 - 1], radius=int(size * 4 * radius), fill=TILE + (255,))
    inner = int(size * 4 * (1 - 2 * inset))
    m = mark_light.resize((inner, inner), Image.LANCZOS)
    off = (size * 4 - inner) // 2
    tile.alpha_composite(m, (off, off))
    return tile.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rgb = np.asarray(Image.open(SRC).convert("RGB"), float)
    alpha, is_blue = unmix(rgb)

    for name, ink in (("logo-mark", NAVY), ("logo-mark-dark", INK_DARK_MODE)):
        mark = square_crop(render(alpha, is_blue, ink))
        mark.resize((96, 96), Image.LANCZOS).save(OUT / f"{name}.png", optimize=True)
        if name == "logo-mark-dark":
            light_mark = mark

    favicon(light_mark, 32).save(OUT / "favicon-32.png", optimize=True)
    favicon(light_mark, 180, radius=0.0).save(OUT / "apple-touch-icon.png", optimize=True)
    favicon(light_mark, 48).save(OUT.parent / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("written to", OUT)


if __name__ == "__main__":
    main()
