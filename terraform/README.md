# Terraform — schedule generator infrastructure

Provisions the app on **Azure Container Apps**, persisting to a blob container
inside an **existing Azure Storage account** (configurable via
`storage_account_name` / `storage_account_resource_group_name`; Terraform only
reads it via a data source — it doesn't create or manage the account itself).
The image is **not built by Terraform** either — it deploys the public Docker
Hub image `sebagomez/schedule_generator` (configurable via `docker_image` /
`image_tag`); build and push it yourself.

> **Not validated against Azure.** Neither `terraform` nor the `az` CLI is
> installed in the environment where this was written, so it has never been
> `init`/`validate`/`plan`ed, let alone applied. Treat the first `terraform plan`
> as the real review step and expect to fix a detail or two.

## What it creates

| Resource | Notes |
|---|---|
| Resource group | `rg-<name_prefix>` unless overridden |
| Blob container `private` | Created inside the *existing* storage account named by `storage_account_name` |
| Log Analytics workspace | Required by Container Apps |
| Container Apps environment | |
| Container App | External ingress on port 3000, 1 replica max, health probes on `/api/health`, pulls `docker_image:image_tag` from Docker Hub (public, no registry credentials configured) |

Not created: the storage account itself. It must already exist (default
`sebagomez` in resource group `teststorageaccount`) — Terraform only reads it
via a data source to get its connection string.

## Prerequisites

- Terraform >= 1.5
- Azure CLI, logged in (`az login`)
- A subscription selected (`az account set --subscription ...`), or `ARM_SUBSCRIPTION_ID` exported
- Docker, to build and push `sebagomez/schedule_generator` yourself
- An existing storage account (see `storage_account_name` / `storage_account_resource_group_name`)

## Usage

```bash
docker build -t sebagomez/schedule_generator:latest .
docker push sebagomez/schedule_generator:latest

cd terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: set schedule_password at minimum

terraform init
terraform plan
terraform apply

terraform output app_url
```

To deploy a code change: build and push a new image, then re-`apply`. Container
Apps only creates a new revision when the deployed image *reference* changes, so
pushing over an unchanged tag (e.g. `latest`) and re-running `apply` won't roll
it out — set `image_tag` to something that changes (a version, a git sha) each
time you want a new revision.

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

**No container registry.** The app deploys straight from a public Docker Hub
repo, so there's no ACR, no registry credentials, and no `az acr build` step to
depend on. The tradeoff: building and pushing the image is on you, and Terraform
has no way to detect that a new image landed behind an unchanged tag (see
"Usage" above).

**Secrets land in state.** `schedule_password`, the generated `session_secret`
and the storage connection string are all in `terraform.tfstate`. Local state
is the default; for anything shared, uncomment the `azurerm` backend in
`versions.tf` and keep the state in a private container.

**Storage account is a data source, not a resource.** It's read-only from
Terraform's perspective — `terraform destroy` never touches it, and running
this config against someone else's storage account can't accidentally modify
or delete it. Only the blob container inside it is managed (created/destroyed)
by Terraform.

## Provider version

Pinned to `azurerm ~> 3.116`. To move to 4.x:

- `azurerm_storage_container.storage_account_name` → `storage_account_id`
- The provider requires an explicit `subscription_id` (or `ARM_SUBSCRIPTION_ID`)

That renamed attribute is flagged with a comment in `main.tf`.

## Teardown

```bash
terraform destroy
```

This deletes the blob container — and with it your schedule overrides — but
leaves the storage account itself untouched (Terraform never created it).
Download `swaps.json` first if you care about it.
