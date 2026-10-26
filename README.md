# xCloud — cloud file storage

A self-hosted file storage and sharing website:

- **Accounts** — sign up / log in (scrypt-hashed passwords, HttpOnly session cookies, CSRF protection, login rate limiting).
- **Dashboard** — drag-and-drop multi-file upload with per-file progress, speed and cancel; search, sort, rename, delete (single or bulk), public/private toggle, copy share link, direct owner download, storage quota bar and download stats.
- **Download page** (`/f/<slug>`) — file details, an animated **countdown timer** before the download button unlocks, and **5 ad slots** (header, below the timer, two sidebar units, footer). The wait is also enforced on the server, so the timer can't be skipped by calling the download URL directly.

No npm dependencies: it uses Node's built-in `http` server and `node:sqlite`.

## Run it

Requires **Node.js 22.13+**.

```bash
cp .env.example .env   # optional, adjust settings
npm start              # http://localhost:3000
```

Data (SQLite database and uploaded files) is stored in `data/` (configurable via `DATA_DIR`).

## Configuration (`.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `SITE_NAME` | `xCloud` | Name shown in the header and titles |
| `BASE_URL` | *(request host)* | Public URL used in share links, e.g. `https://files.example.com` |
| `MAX_FILE_SIZE_MB` | `500` | Max size per upload |
| `USER_QUOTA_MB` | `2048` | Storage per user |
| `DOWNLOAD_WAIT_SECONDS` | `15` | Countdown on the download page (`0` disables it) |
| `DOWNLOAD_TICKET_TTL_MINUTES` | `60` | How long a download page stays valid before the timer restarts |
| `SHOW_AD_PLACEHOLDERS` | `true` | Show dashed "Your ad here" boxes for empty ad slots |
| `ALLOW_REGISTRATION` | `true` | Allow new sign-ups |
| `SECURE_COOKIES` / `TRUST_PROXY` | `false` | Set to `true` when served over HTTPS behind a reverse proxy |

## Adding ads

Each ad slot is a plain HTML file in `ads/`. Paste your ad network code (Google AdSense, Adsterra, PropellerAds, …) into it — changes are picked up without a restart:

| File | Where it appears |
| --- | --- |
| `ads/head.html` | Inside `<head>` on every page (network loader script) |
| `ads/header.html` | 728×90 banner above the file card |
| `ads/countdown.html` | 468×60 banner right below the countdown/download button |
| `ads/sidebar.html` | 300×250 sidebar rectangle |
| `ads/sidebar2.html` | 300×600 sidebar skyscraper |
| `ads/footer.html` | 728×90 banner at the bottom |

Ready-made AdSense templates are in `ads/examples/` — copy them up one level and replace the `ca-pub-…` / slot IDs.

## Project layout

```
src/server.js   routes: pages, download flow, JSON API, static files
src/views.js    HTML templates (auto-escaped)
src/auth.js     passwords, sessions, CSRF, rate limiting
src/db.js       SQLite schema
src/ads.js      ad slot loader
public/         CSS, dashboard.js, download.js (countdown)
ads/            your ad snippets
```

## Production notes

- Put it behind nginx/Caddy with HTTPS and set `SECURE_COOKIES=true`, `TRUST_PROXY=true`, `BASE_URL=…`.
- Raise the proxy's body size limit to match `MAX_FILE_SIZE_MB` (e.g. nginx `client_max_body_size 500m;`).
- Back up the `data/` directory.
