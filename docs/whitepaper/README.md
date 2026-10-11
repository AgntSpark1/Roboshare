# Whitepaper PDFs

Designed Chinese and English whitepaper shown on the investor site at `/whitepaper`.

- Content: `zh.mjs` (reference text) and `en.mjs` (translation). Facts must match `docs/WHITEPAPER.md`, `TOKENOMICS.md`, `RISK_DISCLOSURES.md` and `EARLY_EXIT_DESIGN.md`; no unconfirmed numbers, partners or return promises.
- Layout: `style.css`, `arch.css`, artwork in `art.mjs`.
- Build: `NODE_PATH=$(npm root -g) node docs/whitepaper/build.mjs` (needs the `playwright` package and Chromium, set `PW_CHROMIUM_PATH` if not in the default location; poppler-utils; Python `pypdf`; network access to Google Fonts).
- Output: `apps/web/public/whitepaper/*.pdf`, page previews in `apps/web/public/whitepaper/pages/<zh|en>/`, and `apps/web/src/lib/whitepaper.json` (page counts and sizes). Commit all of them after a rebuild.

Status: draft v0.2, pending legal review before any public offering.
