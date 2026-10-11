#!/usr/bin/env node
// Builds the designed whitepaper PDFs and page previews for the investor site.
//
//   node docs/whitepaper/build.mjs
//
// Needs Playwright's Chromium (PW_CHROMIUM_PATH or the default install), poppler-utils
// (pdfunite, pdftoppm, pdfinfo) and network access to Google Fonts. Output goes to
// apps/web/public/whitepaper/ and apps/web/src/lib/whitepaper.json; commit both.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { coverArt, mark, structure } from "./art.mjs";
import zh from "./zh.mjs";
import en from "./en.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const out = join(root, "apps/web/public/whitepaper");
const tmp = join(here, ".build");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const ICONS = {
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.6-1-1.7-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.5-.6-3.1-1.6M12 6.5v11"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9"/>',
  refund: '<path d="M4 10a8 8 0 1 1 1.8 6.6"/><path d="M4 4v6h6"/>',
  swap: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M21 20c0-2.7-1.8-5-4.2-5.7"/>',
  doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 13h5M10 17h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  shield: '<path d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z"/><path d="M9 12l2 2 4-4"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
};
const icon = (n) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

const FONTS = "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=JetBrains+Mono:wght@400;600&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Sans:wght@400;500;600;700&display=block";
const css = readFileSync(join(here, "style.css"), "utf8") + readFileSync(join(here, "arch.css"), "utf8");
const head = (c) => `<!doctype html><html lang="${c.lang === "en" ? "en" : "zh-CN"}"><head><meta charset="utf-8"><title>${c.docTitle}</title>
<link rel="stylesheet" href="${FONTS}"><style>${css}</style></head>`;

function coverHtml(c) {
  return `${head(c)}<body>
<div class="full cover">${coverArt()}<div class="inner">
  <div class="brand">${mark(34)}<div>RoboShare<small>ROBOTAXI · RWA</small></div></div>
  <div class="eyebrow">${c.cover.eyebrow}</div>
  <h1>${c.cover.title}</h1>
  <p class="sub">${c.cover.sub}</p>
  <div class="chips">${c.cover.chips.map((x) => `<span>${x}</span>`).join("")}</div>
  <div class="foot"><div class="ver">${c.cover.ver}</div><p>${c.cover.note}</p></div>
</div></div></body></html>`;
}

function backHtml(c) {
  return `${head(c)}<body>
<div class="full back">${coverArt({ grid: true })}<div class="inner">
  <div class="brand">${mark(34)}<div>RoboShare<small>ROBOTAXI · RWA</small></div></div>
  <h2>${c.back.title}</h2><p>${c.back.text}</p>
  <div class="end">${c.back.end}<br><br>${c.back.note}</div>
</div></div></body></html>`;
}

function bodyHtml(c) {
  const toc = `<div class="toc"><div class="kicker">${c.lang === "en" ? "Contents" : "CONTENTS"}</div><h2>${c.toc.title}</h2><p class="lede">${c.toc.lede}</p><ol>${c.sections
    .map((s, i) => `<li><span class="n">${String(i + 1).padStart(2, "0")}</span><span class="t">${s.title}</span><span class="d">${s.toc}</span></li>`)
    .join("")}</ol></div>`;
  const body = c.sections
    .map((s) => `<section class="ch${s.page ? "" : " flow"}" id="${s.id}"><div class="kicker">${s.kicker}</div><h2>${s.title}</h2>${s.html}</section>`)
    .join("\n");
  return `${head(c)}<body><div style="break-after:page"></div>${toc}${body}</body></html>`;
}

const footer = (text) => `<div style="width:100%;font-family:'Noto Sans SC','Noto Sans',sans-serif;font-size:7px;color:#8A94AB;padding:0 18mm;display:flex;justify-content:space-between;-webkit-print-color-adjust:exact">
  <span>${text}</span><span class="pageNumber"></span></div>`;

async function render(browser, html, pdfPath, opts) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true, ...opts });
  await page.close();
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(join(out, "pages"), { recursive: true });
const manifest = {};
for (const make of [zh, en]) {
  const c = make({ icon, structure });
  const key = c.lang === "en" ? "en" : "zh";
  const parts = [join(tmp, `${key}-cover.pdf`), join(tmp, `${key}-body.pdf`), join(tmp, `${key}-back.pdf`)];
  await render(browser, coverHtml(c), parts[0], { margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await render(browser, bodyHtml(c), parts[1], {
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: footer(c.footer),
    margin: { top: "20mm", right: "18mm", bottom: "20mm", left: "18mm" },
  });
  await render(browser, backHtml(c), parts[2], { margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  const pdf = join(out, c.file);
  // Drop the body's throwaway first page and join in one writer so fonts are embedded once.
  execFileSync("python3", ["-I", join(here, "merge.py"), pdf, ...parts]);
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [pdf], { encoding: "utf8" }))[1]);
  rmSync(join(out, "pages", key), { recursive: true, force: true });
  mkdirSync(join(out, "pages", key), { recursive: true });
  execFileSync("pdftoppm", ["-jpeg", "-jpegopt", "quality=82,progressive=y", "-scale-to", "900", pdf, join(out, "pages", key, "p")]);
  manifest[key] = { file: `/whitepaper/${c.file}`, pages, bytes: statSync(pdf).size, sections: c.sections.length };
  console.log(`${c.file}: ${pages} pages, ${(statSync(pdf).size / 1024).toFixed(0)} KB`);
}
await browser.close();
rmSync(tmp, { recursive: true, force: true });
writeFileSync(join(root, "apps/web/src/lib/whitepaper.json"), JSON.stringify({ version: "0.2", date: "2026-10", ...manifest }, null, 2) + "\n");
