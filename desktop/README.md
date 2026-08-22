# NotebookLM Pro Desktop

Electron desktop client for the local NotebookLM REST server.

## Development

Create a development renderer env file when you run the UI directly in the
browser:

```bash
cd desktop
cp .env.development.example .env.development
```

Terminal 1:

```bash
cd desktop
npm install
npm run dev
```

Terminal 2:

```bash
cd desktop
npm run desktop
```

The Electron main process starts `uv run --extra server notebooklm-server` on a
random loopback port and injects a per-session bearer token through the preload
bridge.

## Production Build

Production builds read `.env.production` when it exists. Keep
`VITE_NOTEBOOKLM_API_BASE` blank for the normal Electron build so requests keep
using the preload bridge.

```bash
cd desktop
cp .env.production.example .env.production
npm run build
npm run electron
```

The built renderer is loaded from `desktop/dist/index.html`.

## Chrome Profile 185 login

The `Profile 185` action is the production login path. Electron launches the
installed Google Chrome binary with `--profile-directory=Profile 185` and opens
the hosted login bridge. The bridge asks the Drive Down Cookies extension in
that same profile to open NotebookLM, waits for Google sign-in, and retries the
cookie sync until the VPS reloads the NotebookLM client and verifies a live
notebook request. Electron then imports the same profile cookies locally with
`notebooklm login --browser-cookies "chrome::Profile 185"` so the local backend
is usable after the VPS check succeeds.

Each launch carries a random, non-secret correlation UUID through the bridge,
extension upload, and `/sync/connected` poll. This prevents an older healthy VPS
session from being mistaken for completion of the login that was just opened.

Optional launcher overrides are:

```bash
NOTEBOOKLM_CHROME_PATH=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
NOTEBOOKLM_CHROME_USER_DATA_DIR="$HOME/Library/Application Support/Google/Chrome"
NOTEBOOKLM_CHROME_PROFILE_DIRECTORY="Profile 185"
```

The bearer token stays in trusted extension storage and is never put in the
bridge URL or renderer logs. The VPS endpoint still applies its challenge,
cookie allowlist, atomic write, rollback, and live-auth checks.

## UI QA

```bash
cd desktop
npm run test:ui
npm run test:ui:headed
```

The Playwright suite injects a mock preload bridge, checks the main workspace
across 1440, 1280, 1100, and 900px viewports, and fails on console errors,
horizontal overflow, tiny controls, modal overflow, and obvious panel overlap.

The Electron-only launcher contract can be tested without opening Chrome:

```bash
cd desktop
npm run test:electron
```

Live login QA must use Computer Use, confirm `chrome://version` reports
`Profile 185`, complete Google sign-in in NotebookLM, and verify both the VPS
connection and local desktop notebook listing.
