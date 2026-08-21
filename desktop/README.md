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

## UI QA

```bash
cd desktop
npm run test:ui
npm run test:ui:headed
```

The Playwright suite injects a mock preload bridge, checks the main workspace
across 1440, 1280, 1100, and 900px viewports, and fails on console errors,
horizontal overflow, tiny controls, modal overflow, and obvious panel overlap.
