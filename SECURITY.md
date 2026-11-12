# Security

The site is static and read-only: no login, no forms, no uploads. It runs on GitHub Pages, and it changes only when a new version is pushed to this repo.

## The website

| Threat | Protection | Where |
| --- | --- | --- |
| Code injected through texts (XSS) | Every text is escaped before it enters the page. Only `**bold**` and plain `https://` links become HTML. | `esc()`, `rich()` in `app.js` |
| Image addresses like `javascript:` | Images must point to `assets/…` or `https://…`. | `safeSrc()` in `app.js` |
| Foreign scripts | Content-Security-Policy as a `<meta>` tag: only the site's own scripts (plus the inline theme script, by its SHA-256 hash), no plugins, no forms, no other websites. | `index.html` |
| Leaking where visitors came from | `Referrer-Policy: strict-origin-when-cross-origin` | `index.html` |
| Personal data collected by bots | No address, birth date or reference contact details are published. Photos carry no location data. | `content.json` |

GitHub Pages can't send custom headers, so framing protection (`frame-ancestors`, `X-Frame-Options`) is not possible there. The local preview server sends it.

`npm test` checks the escaping, that the CSP fingerprint matches the theme script, and that no unused photo is published.

## The local preview server (`npm start`)

Only reads files, only listens on `127.0.0.1`, only answers to `localhost` / `127.0.0.1`, only allows `GET`/`HEAD`, and only serves `index.html`, `content.json` and `assets/`. It sends the full set of security headers, and broken or odd requests can't crash it.
