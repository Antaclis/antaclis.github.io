# tools

Helper scripts for the website. Nothing here is published; GitHub Pages only serves `site/`.
Requires Python with `numpy` and `Pillow`. Run everything from the repo root.

| Script | What it does |
| --- | --- |
| `python tools/brand.py` | Builds the logo variants and favicons in `site/assets/` (plus `site/favicon.ico`) from `a-logo-white.png`. |
| `python tools/fieldlines.py` | Computes the hero field lines and writes them into `site/index.html` and `tools/og.html`, between the `FIELD-LINES` markers. To change the drawing, edit `DIPOLES` and `LOOPS` at the top of the script. |
| `site/field.js` (not a tool, but related) | The live hero animation. It replaces the static SVG in the browser. Expansion speed, sway, pulse length and timings are set at the top of the file and in `state(t)`. The static SVG is still used without JavaScript or with "reduce motion" on. |
| `og.html` | Source of the social preview image `site/assets/og.png` (1200×630). To regenerate it with Chrome: |

```sh
chrome --headless=new --hide-scrollbars --window-size=1200,630 \
  --screenshot=site/assets/og.png "file:///<full path>/tools/og.html"
```
