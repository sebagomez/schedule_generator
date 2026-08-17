# Terraform — schedule generator infrastructure

Provisions the app on **Azure Container Apps** with **Azure Blob Storage** for
persistence, and builds the container image with **ACR Tasks** (so no local
Docker daemon is needed).

> **Not validated against Azure.** Neither `terraform` nor the `az` CLI is
> installed in the environment where this was written, so it has never been
> `init`/`validate`/`plan`ed, let alone applied. Treat the first `terraform plan`
> as the real review step and expect to fix a detail or two.

## What it creates

| Resource | Notes |
|---|---|
| Resource group | `rg-<name_prefix>` unless overridden |
| Storage account + blob container | `private`, TLS 1.2, no public blobs, 7-day soft delete + versioning |
| Container registry | Basic SKU, admin user enabled (see below) |
| Log Analytics workspace | Required by Container Apps |
| Container Apps environment | |
| Container App | External ingress on port 3000, 1 replica max, health probes on `/api/health` |

## Prerequisites

- Terraform >= 1.5
- Azure CLI, logged in (`az login`) — used by the image build step
- A subscription selected (`az account set --subscription ...`), or `ARM_SUBSCRIPTION_ID` exported

## Usage

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: set schedule_password at minimum

terraform init
terraform plan
terraform apply

terraform output app_url
```

To deploy a code change, just `terraform apply` again: the image tag is derived
from a hash of the app source files, so editing `server.js` (or any other listed
file) produces a new tag, a fresh `az acr build`, and a new revision.

## Seeding existing data

Your local `data/swaps.json` maps 1:1 onto a blob of the same name:

```bash
az storage blob upload \
  --account-name "$(terraform output -raw storage_account_name)" \
  --container-name "$(terraform output -raw storage_container_name)" \
  --name swaps.json \
  --file ../data/swaps.json
```

`settings.json` is **not** needed: both auth secrets are supplied as environment
variables, so the app never creates or reads that document.

## Design decisions worth knowing

**Never more than one replica.** Three things enforce this:

1. `max_replicas = 1`, written as a literal and deliberately **not** exposed as a variable, so it can't be raised from `terraform.tfvars`.
2. **No scale rules** (no HTTP concurrency rule, no KEDA rules), so nothing can request extra replicas.
3. `revision_mode = "Single"`, so only one revision is active at a time.

The reason is `storage.js`: it caches both JSON documents in memory and writes
through, so a second replica would serve a stale copy and overwrite the first.

The one remaining gap is honest to acknowledge: **during a revision rollout,
Container Apps briefly runs the old and new revision at once.** Azure has no
"max surge 0" knob for this. So `storage.js` also applies optimistic concurrency
— blob writes carry an `If-Match` on the ETag last read, so an overlapping stale
instance gets a 412, re-syncs, and surfaces a 409 to the client instead of
silently destroying newer data. Rollouts are the only time you'd ever see it,
and only if you were mid-edit.

**Scale to zero by default.** `min_replicas` defaults to `0`, so the app costs
essentially nothing when idle (well inside the Container Apps free monthly grant)
and pays for it with a few seconds' cold start on the first request after idling.
This is safe *because* persistence is in blob storage: the in-memory cache in
`storage.js` is rebuilt by `storage.init()` on every start, so nothing is lost
when the replica is reclaimed. Set `min_replicas = 1` to keep it warm instead.
`min_replicas` is validated to 0 or 1.

**Registry admin credentials, not managed identity.** A system-assigned identity
with an `AcrPull` role assignment is the tidier pattern, but it has a
creation-order race: the app must pull its image before its identity exists and
the role propagates. Admin credentials avoid that. The password is stored as a
Container Apps secret, not an env var.

**Image build is a `null_resource`.** Terraform doesn't build images. Rather than
requiring a separate manual `docker build && docker push`, a `local-exec` calls
`az acr build`, which builds server-side. Consequences: the apply depends on the
`az` CLI being present and authenticated, and it's not something `terraform plan`
can preview meaningfully.

**Secrets land in state.** `schedule_password`, the generated `session_secret`,
the storage connection string and the registry password are all in
`terraform.tfstate`. Local state is the default; for anything shared, uncomment
the `azurerm` backend in `versions.tf` and keep the state in a private container.

## Provider version

Pinned to `azurerm ~> 3.116`. To move to 4.x:

- `azurerm_storage_container.storage_account_name` → `storage_account_id`
- `azurerm_storage_account.enable_https_traffic_only` → `https_traffic_only_enabled`
- The provider requires an explicit `subscription_id` (or `ARM_SUBSCRIPTION_ID`)

Both renamed attributes are flagged with a comment in `main.tf`.

## Teardown

```bash
terraform destroy
```

This deletes the storage account, and with it your schedule overrides. Download
`swaps.json` first if you care about it.
