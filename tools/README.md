# tools

Helper scripts for the website. Nothing here is published; GitHub Pages only serves `site/`.
The Python tools need `numpy` and `Pillow`. One way to get them without installing anything globally is `uv run --with numpy --with pillow python tools/<script>.py`. Run everything from the repo root.

| Script | What it does |
| --- | --- |
| `python tools/brand.py` | Builds the logo variants and favicons in `site/assets/` (plus `site/favicon.ico`) from `a-logo-white.png`. |
| `python tools/fieldlines.py` | Computes the hero field lines and writes them into `site/index.html` and `tools/og.html`, between the `FIELD-LINES` markers. To change the drawing, edit `DIPOLES` and `LOOPS` at the top of the script. |
| `site/stage/model.js`, `sequence.js`, `stage.js` (not tools, but related) | The live hero stage. `model.js` is the field physics, `sequence.js` turns scroll, time and drag into state and fits the camera, `stage.js` is the three.js scene. Two debug hooks on the page URL: `?p=<0..1>` jumps to a position in the sequence, and `?nowebgl=1` forces the static fallback. |
| `npm test` | Runs the unit and content tests in `tests/` with `node --test`. |
| `og.html` | Source of the social preview image `site/assets/og.png` (1200×630). To regenerate it with Chrome: |

```sh
chrome --headless=new --hide-scrollbars --virtual-time-budget=2000 --window-size=1200,630 \
  --screenshot=site/assets/og.png "file:///<full path>/tools/og.html"
```
