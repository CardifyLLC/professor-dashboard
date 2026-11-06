# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Daily regular-order PDF calibration (draft, 2026-11-06)

The daily worker reads `scripts/regular-order-layout.mjs`; browser-local
BatcherPRO defaults do not configure this worker. This draft uses the supplied
offset transcription. **Professor confirmed the unlabeled X/Y zero offsets
on 2026-11-06. A physical duplex print proof still needs approval before
production deployment.**

Regular base layout: Gap X **2.6 mm** (supersedes 2.45), Gap Y **6.4 mm**,
top margin **15.5 mm**, left margin **9.7 mm**. Cards remain 67 x 92 mm,
6 columns x 3 rows on 457.2 x 304.8 mm paper, at 1200 DPI / JPEG quality 50.
All other printing settings are retained.

| Front sheet row | X adjustments in mm, left to right |
| --- | --- |
| 1 | 0*, 0*, 0*, 0*, 0*, 0* |
| 2 | 0*, -0.2, -0.1, -0.2, -0.2, -0.2 |
| 3 | -0.2, -0.3, -0.4, -0.5, -0.6, -0.6 |

`*` Professor confirmed these unlabeled slots have X=0 and Y=0. All Y adjustments
are zero. Offsets belong to positions on
each sheet, including partial sheets and the first sheet of a new PDF part.
Backs use the adjusted front X, vertical reflection, and 180-degree artwork
rotation. Missing backs retain their slots. Cut outlines follow the artwork.
The 3.3 x 60 mm registration bar stays at X=7 mm; its top is 60.4 mm on the
front and 184.4 mm on the back, measured from each page's top.

This production worker predates the testing branch's stock-separated renderer.
Only wholly regular orders (standard/gloss, without foil masks) receive this
calibration. Foil, mixed-finish, unknown-finish and legacy masked orders retain
the previous worker geometry, including Gap X=2.45 and zero slot offsets.
This patch does not change the foil Batcher station or introduce new foil
dimensions. Stock-separated worker changes require a separate review.

### Reproduce the isolated proof

Run from the repository root after `npm ci`:

```sh
node --test scripts/regular-order-layout.test.mjs
node --test scripts/download-order-image.test.mjs scripts/order-pdf-downloads.test.mjs scripts/order-pdf-downloads-api.test.mjs
node scripts/generate-order-pdfs.mjs --sample regular-calibration.pdf 52 standard
node scripts/generate-order-pdfs.mjs --sample foil-regression.pdf 18 silver
```

Sample mode needs no credentials, reads no customer artwork and never touches
Supabase, storage, job queues, email or payments. It refuses to overwrite an
existing output file. The regular sample contains two full sheets and a final
16-card sheet, each paired with its back (6 PDF pages). The foil sample is a
regression proof of the previous geometry, not an approved foil print template.

Automated results on 2026-11-06: **3/3 calibration/worker tests and 18/18 existing
download/image tests passed.** Assertions inspect the generated PDF's image
matrices, raster dimensions, cut outlines and registration bar on every page.
They cover repeated and partial sheets, foil/mixed exclusion, and a completed
job encountered during processing: no artwork fetch, update or upload occurs.
All eight sample pages were rendered with Poppler and visually checked.

Measured front X coordinates in mm:

| Row | Column 1 | Column 2 | Column 3 | Column 4 | Column 5 | Column 6 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 (top 15.5) | 9.7 | 79.3 | 148.9 | 218.5 | 288.1 | 357.7 |
| 2 (top 113.9) | 9.7 | 79.1 | 148.8 | 218.3 | 287.9 | 357.5 |
| 3 (top 212.3) | 9.5 | 79.0 | 148.5 | 218.0 | 287.5 | 357.1 |

The base horizontal gap is 2.6 mm; actual edge gaps include the differential
slot adjustment. Row 1: 2.6/2.6/2.6/2.6/2.6; row 2: 2.4/2.7/2.5/2.6/2.6;
row 3: 2.5/2.5/2.5/2.5/2.6 mm. Vertical gaps remain 6.4 mm.

### Required physical confirmation before deployment

1. Unlabeled X/Y zeros confirmed by Professor on 2026-11-06. If values change,
   record corrections in the module and rerun the proof.
2. Print the regular sample at **100% / Actual size**, on 12 x 18 inch paper,
   using the existing short-edge duplex configuration. Disable Fit, Shrink,
   scaling, auto-centering and any extra printer-driver position corrections.
3. Measure card bounds (67 x 92 mm), margins and the gaps above. Hold the sheet
   to light and compare matching front/back slot IDs, center crosshairs, cut
   outlines and registration bars on both full sheets and the partial sheet.
   Record measured alignment error and obtain the print operator's acceptance;
   mathematical PDF alignment does not establish printer/feed alignment.
4. Deploy only after approval. Completed customer PDFs must not be reset,
   overwritten or regenerated. Any later customer reprint needs an explicit
   approved order list. Do not run `--stage-order` for unapproved orders.

No database migration or SQL is needed for this calibration.
