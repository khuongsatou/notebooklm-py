# Remote `notebooklm-mcp` — Docker + Cloudflare Tunnel

Run the MCP server as a **remote connector** (Claude Code / Claude.ai / Cursor)
behind a Cloudflare Tunnel: no public IP, no open ports, no TLS certificate to
manage. Single-tenant, self-hosted.

> ⚠️ **Use a dedicated / throwaway Google account.** The mounted
> `master_token.json` is a durable, full-account credential. Treat the mounted profile dir
> and `.env` as secrets (both are gitignored).

## Prerequisites
- Docker + Docker Compose.
- A domain on Cloudflare (free plan is fine) for the Tunnel hostname.

## 1. Bootstrap the master token (once, on a machine with a browser)
```bash
pip install "notebooklm-py[browser,headless]"
notebooklm login --master-token --account you@example.com
```
This writes `master_token.json` (+ a minted `storage_state.json`) into
`~/.notebooklm/profiles/<profile>/`. **You don't copy or chown anything** — the
container mounts that dir directly and runs as *your* uid:gid, so the files stay
owned by you (your `notebooklm` CLI keeps working) and are readable/writable with
no permission dance.

- **Default:** mounts `~/.notebooklm/profiles/default`.
- **Other profile:** set `NOTEBOOKLM_PROFILE_DIR` in `.env` (e.g. a
  dedicated/throwaway profile — recommended, since `master_token.json` is a
  full-account credential).

The dir is mounted **read-write** because the server re-mints/rotates cookies into
`storage_state.json` (+ its `.lock`) — a read-only mount makes the session die
~1 h in. Running as your uid is what makes that write work without a chown.
(`make` fills your uid/gid from `id` automatically; for raw `docker compose`, set
`NOTEBOOKLM_UID`/`NOTEBOOKLM_GID` in `.env`.)

## 2. Configure secrets
```bash
cp deploy/.env.example deploy/.env
# NOTEBOOKLM_MCP_TOKEN: python -c "import secrets; print(secrets.token_urlsafe(32))"
# CF_TUNNEL_TOKEN: from the Cloudflare dashboard (next step)
```

## 3. Create the Cloudflare Tunnel
In the Cloudflare **Zero Trust** dashboard → **Networks → Tunnels**:
1. Create a tunnel; copy its **token** into `CF_TUNNEL_TOKEN` in `.env`.
2. Add a **Public Hostname** (e.g. `notebooklm-mcp.yourdomain.com`) →
   **Service** `http://notebooklm-mcp:9420`. Cloudflare auto-creates the DNS
   record and serves TLS with its own cert.

## 4. Run

The `Makefile` wraps the two build modes — one command each:

```bash
cd deploy
make dev                    # build + install THIS checkout (source) and start
make prod VERSION=0.8.0     # build + install a published PyPI release and start
make logs                   # tail the server log (expect: bound 0.0.0.0:9420)
make restart                # rebuild + recreate after a source/config change
make down                   # stop and remove
```

Equivalent raw compose (the image installs `notebooklm-py` two ways; build
context is the repo root):
- **From source (default):** `docker compose up -d --build` installs *this
  checkout* — you deploy the exact code in the repo (right for dev / an
  unreleased branch).
- **From a published release:** `docker compose build --build-arg
  NOTEBOOKLM_SPEC="notebooklm-py[mcp,headless]==0.8.0"` then `docker compose up -d`
  (or uncomment `build.args.NOTEBOOKLM_SPEC` in `docker-compose.yml`).

## 5. Connect from Claude Code
```bash
claude mcp add --transport http notebooklm \
  https://notebooklm-mcp.yourdomain.com/mcp \
  --header "Authorization: Bearer $NOTEBOOKLM_MCP_TOKEN"
```
Claude **Desktop** also accepts the bearer. Claude **.ai** (web/mobile) does
not — its connector UI is OAuth-only — so use step 6 for it.

## 6. (Optional) Connect from claude.ai — OAuth via WorkOS AuthKit
claude.ai's custom-connector UI has no bearer-token field; it only speaks OAuth.
WorkOS **AuthKit** (free tier) is the OAuth authorization server that gives claude.ai
something to log in against, while our server stays a *resource server* that just
validates the resulting token. **This is opt-in and additive** — leave all four env
vars unset to stay bearer-only (Claude Code / Desktop keep working unchanged).

> Dashboard paths below are current as of mid-2026; WorkOS occasionally relabels
> menus. The four things you must end up with: **DCR enabled**, **email in the
> access token**, your **AuthKit domain**, and your **project Client ID**.

### 6a. Create the AuthKit project
1. Sign up at **dashboard.workos.com**. A **Staging** environment is created for you
   automatically (do the whole setup there first, then repeat for Production). AuthKit
   is on by default for new environments.
2. **Email + Password sign-in is enabled by default**, so you can log in right away —
   no method to turn on. To *add* a social option (Google / Microsoft / GitHub), use
   the dashboard's **"Get started" onboarding** (it walks you through authentication
   methods, the redirect URI, and your API keys) or the **Users** area. Exact menu
   labels move around between WorkOS releases — follow the in-dashboard onboarding
   rather than a fixed path. This is just how *you* prove identity at the claude.ai
   login; the connector works with the default Email + Password.

### 6b. Enable Dynamic Client Registration (so claude.ai can self-register)
claude.ai has no pre-shared client credentials with your server — it registers
itself at connect time. Enable that:
- **Dashboard → Applications → Connect → Configuration → enable “Dynamic Client
  Registration” (DCR).**
  *(WorkOS's newer “Client ID Metadata Document (CIMD)” also works for clients that
  support it; enabling DCR covers claude.ai today. Enable both if offered.)*

### 6c. Put `email` + `email_verified` in the ACCESS token (the load-bearing step)
Our allowlist reads the `email` claim off the **access token** (the JWT claude.ai
presents to our server) — and WorkOS does **not** put `email` there by default. Add
a JWT Template:
- **Dashboard → Authentication → Features → JWT Template**, and add:
  ```json
  {
    "email": {{ user.email }},
    "email_verified": {{ user.email_verified }}
  }
  ```
  (Reserved claims `iss`/`sub`/`exp`/`iat`/`nbf`/`jti` can't be overridden.) Without
  this, the connector correctly **rejects every login** — see the verify step (6f).

### 6d. Do NOT configure Resource Indicators (audience must equal your Client ID)
Our server (via FastMCP `AuthKitProvider`) validates the token's `aud` claim against
your **project Client ID**. WorkOS's optional *Resource Indicators* feature would
instead set `aud` to your MCP URL — which our server would then reject. So **leave
Resource Indicators unset** (the default), so `aud` stays the project default that
equals your Client ID. (If a future setup needs resource-bound audiences, that's a
small code change — open an issue.)

### 6e. Collect the values and start the server
- **AuthKit domain:** **Authentication → AuthKit** (e.g. `https://your-project.authkit.app`).
- **Client ID:** **Dashboard → API Keys** → the `client_01…` value (project-level —
  NOT a per-client DCR id, NOT the secret API key).
- Put them in `deploy/.env` (see `.env.example`); leave blank to stay bearer-only:
  ```
  NOTEBOOKLM_MCP_AUTHKIT_DOMAIN=https://your-project.authkit.app
  NOTEBOOKLM_MCP_AUTHKIT_CLIENT_ID=client_01XXXXXXXXXXXXXXXXXXXXXXXX
  NOTEBOOKLM_MCP_AUTHKIT_BASE_URL=https://<your-host>      # your public tunnel URL
  NOTEBOOKLM_MCP_ALLOWED_EMAILS=you@example.com            # who OAuth admits
  ```
  Then `make dev` (or `make prod VERSION=…`). All four are required together —
  partial config refuses to start.

### 6f. Verify the token BEFORE adding the connector (saves debugging)
The two failure modes (missing `email`, wrong `aud`) are invisible until a token is
issued. Confirm with WorkOS's **Authentication → Users → (a user) → “Get access
token”** (or any AuthKit login), copy the JWT, and paste it into **jwt.io**:
- `aud` **equals your `NOTEBOOKLM_MCP_AUTHKIT_CLIENT_ID`** → audience OK.
- `email` is present and `email_verified` is `true` → allowlist will admit it.
If `aud` is a URL or some other value instead of the client id, you have Resource
Indicators configured (undo 6d) or a WorkOS/FastMCP version skew — stop and open an
issue rather than guessing.

### 6g. Add the connector on claude.ai
- **claude.ai → Settings → Connectors → Add custom connector** → URL
  `https://<your-host>/mcp`. The browser OAuth flow runs via WorkOS; only emails in
  your allowlist are admitted. Claude Code keeps using the bearer — both work at once.

> The `email` allowlist is the real backstop — without it, *any* WorkOS-authenticated
> user could reach your account — so it is **mandatory** whenever OAuth is enabled.
> (A harmless `authlib.jose` deprecation line from FastMCP may print on startup.)

> **The default compose still requires `NOTEBOOKLM_MCP_TOKEN`** — OAuth is layered on
> top of the bearer (so Claude Code/Desktop keep working). For an **OAuth-only** deploy
> with no bearer, drop the `:?` guard on `NOTEBOOKLM_MCP_TOKEN` in `docker-compose.yml`;
> the server's own fail-closed check still requires bearer *or* OAuth on a network bind.

## Notes & security
- **Two auth layers.** The `NOTEBOOKLM_MCP_TOKEN` bearer gates *who can use the
  endpoint*; the master token authenticates *the server to Google*. The master
  token **never** traverses the tunnel — only MCP tool calls/results do. The
  bearer **does** terminate at Cloudflare (Cloudflare can see it in transit, like
  any reverse-proxied request), so rotate it freely.
- **Fail-closed.** The server refuses to start on a non-loopback bind with no
  auth at all (neither `NOTEBOOKLM_MCP_TOKEN` nor WorkOS OAuth), and refuses
  partial/allowlist-less OAuth config.
- **One container per account.** Do not scale replicas off one master token —
  concurrent re-mints invalidate each other's session.
- **Rotate the bearer**: change `NOTEBOOKLM_MCP_TOKEN` in `.env`,
  `docker compose up -d`, and update the `claude mcp add` header.
- **Files**: the connector moves text/references only. Add device files via
  Google Drive (`source_add` with a Drive id) or the NotebookLM app; consume
  generated podcasts/videos/slides in the NotebookLM app (same account).
- **Optional hardening**: instead of a single `rw` bind-mount, mount
  `master_token.json` as a separate read-only Docker secret and use a writable
  named volume for `storage_state.json` + `.storage_state.json.lock`.
