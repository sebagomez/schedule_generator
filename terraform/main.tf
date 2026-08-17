locals {
  resource_group_name = var.resource_group_name != "" ? var.resource_group_name : "rg-${var.name_prefix}"

  # Files whose contents determine the image. Changing any of them changes the
  # derived tag, which triggers a rebuild and a new Container Apps revision.
  source_files = [
    "Dockerfile",
    "package.json",
    "server.js",
    "storage.js",
    "script.js",
    "style.css",
    "schedule_generator.html",
    "login.html",
  ]

  source_hash = substr(sha1(join("", [
    for f in local.source_files : filesha256("${path.module}/../${f}")
  ])), 0, 12)

  image_tag  = var.image_tag != "" ? var.image_tag : local.source_hash
  image_name = "schedule-generator"

  session_secret = var.session_secret != "" ? var.session_secret : random_password.session_secret.result
}

# Suffix keeps globally-unique names (storage account, registry) collision-free.
resource "random_string" "suffix" {
  length  = 6
  lower   = true
  upper   = false
  numeric = true
  special = false
}

resource "random_password" "session_secret" {
  length  = 64
  special = false
}

resource "azurerm_resource_group" "main" {
  name     = local.resource_group_name
  location = var.location
  tags     = var.tags
}

# ------------------------------------------------------------------ storage
# Holds swaps.json (and settings.json when auth isn't fully env-configured).
# The container filesystem is ephemeral, which is why this exists.

resource "azurerm_storage_account" "main" {
  name                = "st${var.name_prefix}${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tags                = var.tags

  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"

  # NOTE: azurerm 3.x attribute names. In 4.x, enable_https_traffic_only was
  # renamed to https_traffic_only_enabled.
  min_tls_version                 = "TLS1_2"
  enable_https_traffic_only       = true
  allow_nested_items_to_be_public = false
  public_network_access_enabled    = true
  shared_access_key_enabled       = true

  blob_properties {
    # Cheap insurance for a hand-editable JSON document.
    delete_retention_policy {
      days = 7
    }
    versioning_enabled = true
  }
}

resource "azurerm_storage_container" "data" {
  name = var.storage_container_name
  # azurerm 3.x attribute; in 4.x this becomes storage_account_id.
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

# ----------------------------------------------------------------- registry
# Admin credentials are enabled so the Container App can pull with a
# username/password secret. The tidier alternative is a system-assigned identity
# plus an AcrPull role assignment, but that has a creation-order race: the app
# must pull an image before its identity exists. Fine for a single-user tool.

resource "azurerm_container_registry" "main" {
  name                = "cr${var.name_prefix}${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = true
  tags                = var.tags
}

# Builds the image in Azure (ACR Tasks), so no local Docker daemon is needed.
# Requires the Azure CLI to be installed and logged in.
resource "null_resource" "image_build" {
  triggers = {
    image_tag = local.image_tag
    registry  = azurerm_container_registry.main.name
  }

  provisioner "local-exec" {
    working_dir = "${path.module}/.."
    command     = <<-EOT
      az acr build \
        --registry ${azurerm_container_registry.main.name} \
        --image ${local.image_name}:${local.image_tag} \
        --file Dockerfile \
        .
    EOT
  }

  depends_on = [azurerm_container_registry.main]
}

# ----------------------------------------------------------- container apps

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${var.name_prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags                = var.tags
}

resource "azurerm_container_app_environment" "main" {
  name                       = "cae-${var.name_prefix}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  tags                       = var.tags
}

resource "azurerm_container_app" "main" {
  name                         = var.name_prefix
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = var.tags

  secret {
    name  = "storage-connection-string"
    value = azurerm_storage_account.main.primary_connection_string
  }

  secret {
    name  = "schedule-password"
    value = var.schedule_password
  }

  secret {
    name  = "session-secret"
    value = local.session_secret
  }

  secret {
    name  = "registry-password"
    value = azurerm_container_registry.main.admin_password
  }

  registry {
    server               = azurerm_container_registry.main.login_server
    username             = azurerm_container_registry.main.admin_username
    password_secret_name = "registry-password"
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    # IMPORTANT: max_replicas is 1 on purpose and is deliberately NOT a
    # variable, so it can't be raised from tfvars. storage.js caches both JSON
    # documents in memory and writes through, so a second replica would hold a
    # stale copy. With no scale rules defined, this is the hard ceiling.
    #
    # The one case that can still briefly overlap two containers is a revision
    # rollout. storage.js guards that with an If-Match ETag precondition on blob
    # writes, so a stale instance fails loudly instead of losing data.
    min_replicas = var.min_replicas
    max_replicas = 1

    container {
      name   = "schedule-generator"
      image  = "${azurerm_container_registry.main.login_server}/${local.image_name}:${local.image_tag}"
      cpu    = var.cpu
      memory = var.memory

      env {
        name  = "PORT"
        value = "3000"
      }

      # Container Apps terminates TLS at the ingress, so the app is reached over
      # HTTPS and the session cookie must be marked Secure.
      env {
        name  = "COOKIE_SECURE"
        value = "true"
      }

      env {
        name  = "STORAGE_BACKEND"
        value = "azure-blob"
      }

      env {
        name  = "AZURE_STORAGE_CONTAINER"
        value = azurerm_storage_container.data.name
      }

      env {
        name        = "AZURE_STORAGE_CONNECTION_STRING"
        secret_name = "storage-connection-string"
      }

      # Both auth secrets come from configuration, so settings.json is never
      # created and the blob container holds only swaps.json.
      env {
        name        = "SCHEDULE_PASSWORD"
        secret_name = "schedule-password"
      }

      env {
        name        = "SESSION_SECRET"
        secret_name = "session-secret"
      }

      liveness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/api/health"

        initial_delay           = 5
        interval_seconds        = 30
        timeout                 = 3
        failure_count_threshold = 3
      }

      readiness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/api/health"

        interval_seconds        = 10
        timeout                 = 3
        failure_count_threshold = 3
      }
    }
  }

  depends_on = [
    null_resource.image_build,
    azurerm_storage_container.data,
  ]
}
