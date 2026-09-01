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
docker build -t sebagomez/schedule_generator:latest .
docker push sebagomez/schedule_generator:latest

az login
cd terraform
cp terraform.tfvars.example terraform.tfvars   # set schedule_password
terraform init
terraform plan
terraform apply
terraform output app_url
```

Terraform provisions the resource group, blob container, Log Analytics
workspace, Container Apps environment and the app; wires the connection
string, password and session secret in as **Container Apps secrets**; and
deploys the public Docker Hub image `sebagomez/schedule_generator` — Terraform
doesn't build or push it, so build and push it yourself first. The storage
account itself is **not** created by Terraform — it must already exist
(`storage_account_name` / `storage_account_resource_group_name`), and is only
read via a data source for its connection string.

Redeploying a code change means building and pushing a new image, then
`terraform apply` again with `image_tag` set to something new (a version, a git
sha). Container Apps only rolls out a new revision when the deployed image
*reference* changes — re-applying with an unchanged tag like `latest` won't pick
up a new push behind that tag.

If you don't set `session_secret`, Terraform generates one and keeps it in state,
so it stays stable across applies (unlike a shell script, which would have
regenerated it every run).

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

- `GET /api/health` — **liveness**. 200 whenever the process is alive, with a body of `{ok, ready, storage, error}`. If storage is misconfigured, `error` tells you exactly what's wrong.
- `GET /api/ready` — **readiness**. 200 only once storage has loaded, 503 otherwise.
- If the login page loops back on itself, `COOKIE_SECURE` is wrong for the scheme you're using.

The two probes are deliberately different endpoints. Liveness stays 200 on a
storage failure so the platform doesn't kill and crash-loop a container that's
merely misconfigured — the container stays up, and `/api/health` reports the
reason.

## Troubleshooting a crashing container

Container Apps events like `ContainerCrashing`, `ReplicaUnhealthy` or
`connection refused` on the probe are **symptoms**. The cause is in the console
log:

```bash
az containerapp logs show -n <app> -g <rg> --type console --tail 100
az containerapp logs show -n <app> -g <rg> --type system  --tail 50
az containerapp revision list -n <app> -g <rg> -o table
```

| Symptom | Likely cause |
|---|---|
| Container exits instantly, no app logs at all | **Wrong architecture.** Container Apps is amd64-only. An arm64 image (e.g. built on Apple Silicon with `--platform linux/arm64`) dies with `exec format error`. Rebuild with `--platform linux/amd64`, or let `az acr build` do it |
| `STORAGE INITIALISATION FAILED: ...` | Bad or missing storage credentials; the message names the variable |
| `ImagePullBackOff` / registry errors | Registry credentials, not the app |
| App logs look fine but probes fail | Port mismatch — `target_port` must be 3000 |

### Architecture check

```bash
az acr manifest list-metadata --registry <acr> --name schedule-generator -o table
```

Building locally on an Apple Silicon Mac produces arm64 by default. That's right
for running under local podman and **wrong for Azure**. The Terraform path uses
`az acr build`, which builds amd64 server-side and avoids the problem entirely.

## Security caveat, restated

`/api/*` is deliberately unauthenticated. On a public Azure URL that means anyone
who finds the hostname can read and rewrite your schedule with `curl`, even
though the UI asks for a password. To close it, delete the
`req.path.startsWith('/api/')` exemption from the gate middleware in
`server.js` — the browser already sends the session cookie, so the frontend
keeps working. Consider doing that before going public.
