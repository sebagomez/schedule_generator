# Deploying to Azure

Target: **Azure Container Apps** (runs the existing Dockerfile unmodified) with
**Azure Blob Storage** for persistence.

Nothing here has been run against a live subscription — it's prepared for you to
execute when you're ready. The app itself is tested locally (including the blob
backend, against a mocked SDK); the Terraform config and the Docker image build
are **unvalidated**, because `terraform`, `az` and `docker` are all absent from
the environment this was written in.

Infrastructure lives in [terraform/](terraform/) — see
[terraform/README.md](terraform/README.md) for the full resource list and design
notes.

## Why Container Apps and not Static Web Apps

Static Web Apps can't host this app any more. The password gate works by running
Express middleware *in front of* static file serving:

```js
app.use((req, res, next) => { ... res.redirect('/login'); });   // server.js
app.use(express.static(__dirname, { index: 'schedule_generator.html' }));
```

On SWA the static files are served by the platform's CDN, so there's no place to
insert that middleware — the HTML/JS/CSS would be public and the gate would never
run. SWA can protect routes, but only with its own identity providers (Entra ID,
GitHub, Google); it has no notion of a single shared password. Container Apps
runs `server.js` as-is, so the auth you already have keeps working.

## What was prepared

| File | Purpose |
|---|---|
| `storage.js` | Persistence layer with `local` and `azure-blob` backends |
| `.env.example` | Every setting, including the Azure Storage credential placeholders |
| `Dockerfile` | Declares the Azure env vars, adds a healthcheck, runs as non-root |
| `docker-compose.yml` | Optional `.env`, healthcheck, unchanged local behaviour |
| `terraform/` | Terraform config that provisions everything and deploys ([details](terraform/README.md)) |

## Configuration

All credentials are injected at runtime — **nothing is baked into the image**.
See `.env.example` for the full list. The storage-related ones:

| Variable | Notes |
|---|---|
| `STORAGE_BACKEND` | `local` or `azure-blob`. Blank ⇒ inferred from whether credentials exist |
| `AZURE_STORAGE_CONNECTION_STRING` | Simplest option; **placeholder, fill at deploy time** |
| `AZURE_STORAGE_ACCOUNT_NAME` / `AZURE_STORAGE_ACCOUNT_KEY` | Alternative to the connection string |
| `AZURE_STORAGE_CONTAINER` | The specific blob container. Defaults to `schedule-data`, created on startup if absent |
| `SCHEDULE_PASSWORD` | Login password. On Azure prefer this over `settings.json` so the secret lives in app config |
| `SESSION_SECRET` | Signs the session cookie. Set this **and** `SCHEDULE_PASSWORD` and `settings.json` is never created or read at all. Keep it stable across deploys or everyone gets logged out |
| `COOKIE_SECURE` | **Must be `true` on Azure** (HTTPS). Must stay `false` for plain-HTTP local/LAN use |

Documents become blobs in that one container, keeping the on-disk schema
identical — so you can seed the container by uploading your existing
`data/*.json`, or copy blobs back down to run locally.

### Where the password lives

Three valid configurations:

| Config | `settings.json` | Use |
|---|---|---|
| Neither env var | Created, holds `password` + `sessionSecret` | Local / LAN default |
| `SCHEDULE_PASSWORD` only | Created, holds **only** `sessionSecret` | Partial |
| **Both env vars** | **Never created or read** | **Recommended on Azure** |

The Terraform config sets both, so on Azure the blob container holds nothing but
`swaps.json` and the secrets live in Container Apps secrets.
If you supply only the password, the file is still created for the session
secret — but it no longer contains a stale, ignored `password` field.

## Deploy

```bash
az login
cd terraform
cp terraform.tfvars.example terraform.tfvars   # set schedule_password
terraform init
terraform plan
terraform apply
terraform output app_url
```

Terraform provisions the resource group, storage account, blob container,
container registry, Log Analytics workspace, Container Apps environment and the
app; wires the connection string, password and session secret in as **Container
Apps secrets**; and builds the image with `az acr build` (server-side, so no
local Docker needed).

Redeploying a code change is just `terraform apply` again — the image tag is
derived from a hash of the app source, so any edit yields a new tag, a new build
and a new revision.

If you don't set `session_secret`, Terraform generates one and keeps it in state,
so it stays stable across applies (unlike a shell script, which would have
regenerated it every run).

The script creates the resource group, storage account, blob container, Container
Apps environment and the app itself; wires the connection string and password in
as **Container Apps secrets** (referenced via `secretref:`, not plain env values);
and prints the resulting HTTPS URL. Re-running updates the existing app.

## Critical constraint: exactly one replica

`storage.js` caches both JSON documents in memory and writes through on change.
That keeps the request path synchronous and avoids a blob round-trip per request,
but it means **two replicas would each hold their own copy and overwrite each
other's changes.** `max_replicas` is hard-coded to `1` in `terraform/main.tf` as
a literal (not a variable), there are no scale rules, and `revision_mode` is
`Single` — so the app can never scale beyond one container.

A revision rollout is the one moment Azure can briefly run two containers, and
there's no setting to prevent it. So blob writes also use an `If-Match` ETag
precondition: a stale instance gets rejected, re-reads, and the client sees a
**409** rather than losing data. Verified against a mocked storage account with
two simulated instances.

`min_replicas` is a variable, validated to 0 or 1:

- **`0` (default)** — scales to zero when idle, so it costs ~$0 under the free monthly grant. First request after an idle period waits a few seconds for a cold start. Safe because all state is in blob storage and `storage.init()` reloads it on every start.
- `1` — always warm, billed continuously for a 0.25 vCPU / 0.5 GiB container.

## After deploying

- `GET /api/health` returns `{"ok":true,"storage":"azure-blob"}` — confirms the app came up *and* which backend it bound to.
- If the login page loops back on itself, `COOKIE_SECURE` is wrong for the scheme you're using.
- Startup fails fast with a clear message if `STORAGE_BACKEND=azure-blob` but no credentials are set.

## Security caveat, restated

`/api/*` is deliberately unauthenticated. On a public Azure URL that means anyone
who finds the hostname can read and rewrite your schedule with `curl`, even
though the UI asks for a password. To close it, delete the
`req.path.startsWith('/api/')` exemption from the gate middleware in
`server.js` — the browser already sends the session cookie, so the frontend
keeps working. Consider doing that before going public.
