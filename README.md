# Antaclis

The website for Antaclis, a static page with no build step: the files in `site/` are served as they are, and the hero is a WebGL scene in `site/stage/`. Every push to `main` deploys `site/` to GitHub Pages through `.github/workflows/deploy.yml`, and it is served at https://antaclis.com/. To test, run `npm test`; helper scripts for the logo, field lines and social preview are described in `tools/README.md`.
