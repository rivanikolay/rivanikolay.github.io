# Online CV — Nikolay Riva

My CV as a website, in English and German: **<https://rivanikolay.github.io/>**

## Change something

1. Edit [content.json](content.json) (all texts) or the code.
2. Preview it locally: `npm start`, then open <http://localhost:3000>.
3. Check it: `npm run check` (code checker + tests).
4. Commit and push. GitHub Pages puts it online within about a minute.

**Texts** are written as `{ "en": "…", "de": "…" }`. An empty German text shows the English one. `**double asterisks**` make words bold, and an empty line starts a new paragraph.

**Photos** go in `assets/uploads/`. A photo named `name@2400.webp` (2400 = width in pixels) also needs a 900 px copy `name@2400-900.webp` for phones. Under `media`, each photo can have a crop (`x`, `y`, `zoom`) and a `caption` that shows when it is enlarged.

## Tests

Run `npm install` once (developer tools only), then:

| Command | What it does |
| --- | --- |
| `npm test` | Runs all tests |
| `npm run lint` | Checks the code for mistakes |
| `npm run check` | Both. Run it before every push. |
| `npm run coverage` | Shows how much of the code the tests cover |

In VS Code, the "Node.js Test Runner" extension shows the tests in the **Testing** panel.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Page shell, with the security rules (CSP) |
| `content.json` | All texts, photo paths and photo settings |
| `assets/js/app.js` | Builds the page from `content.json` |
| `assets/js/hero-map.js` | Contour map of the See-Gaster region behind the name |
| `assets/css/style.css` | Design |
| `assets/map/`, `tools/build-map.py` | Map data from swisstopo, and the script that downloads it |
| `assets/uploads/` | Photos |
| `server.js` | Local preview server (`npm start`); not used online |
| `tests/` | Tests |
| `SECURITY.md` | What is protected, and how |

Map data © swisstopo.
