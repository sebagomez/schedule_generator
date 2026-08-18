locals {
  resource_group_name = var.resource_group_name != "" ? var.resource_group_name : "rg-${var.name_prefix}"

  # Public Docker Hub image, built and pushed outside of Terraform.
  image = "docker.io/${var.docker_image}:${var.image_tag}"

  session_secret = var.session_secret != "" ? var.session_secret : random_password.session_secret.result
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
#
# Uses a pre-existing storage account (not created or lifecycle-managed by
# Terraform) - only the blob container inside it is managed here.

data "azurerm_storage_account" "main" {
  name                = var.storage_account_name
  resource_group_name = var.storage_account_resource_group_name
}

resource "azurerm_storage_container" "data" {
  name = var.storage_container_name
  # azurerm 3.x attribute; in 4.x this becomes storage_account_id.
  storage_account_name  = data.azurerm_storage_account.main.name
  container_access_type = "private"
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
    value = data.azurerm_storage_account.main.primary_connection_string
  }

  secret {
    name  = "schedule-password"
    value = var.schedule_password
  }

  secret {
    name  = "session-secret"
    value = local.session_secret
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
      image  = local.image
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

  depends_on = [azurerm_storage_container.data]
}
