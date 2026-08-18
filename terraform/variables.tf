variable "name_prefix" {
  description = "Prefix for resource names (resource group, Container Apps environment/app, log analytics workspace)."
  type        = string
  default     = "schedulegen"

  validation {
    condition     = can(regex("^[a-z0-9]{3,12}$", var.name_prefix))
    error_message = "name_prefix must be 3-12 lowercase letters/digits."
  }
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "eastus"
}

variable "resource_group_name" {
  description = "Resource group to create. Defaults to rg-<name_prefix>."
  type        = string
  default     = ""
}

variable "schedule_password" {
  description = "Password for the app's login page. Required - there is no default on purpose."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.schedule_password) >= 8
    error_message = "schedule_password must be at least 8 characters."
  }
}

variable "session_secret" {
  description = <<-EOT
    Secret that signs the session cookie. Leave empty to have one generated and
    kept in Terraform state. Changing it logs everyone out.
  EOT
  type        = string
  sensitive   = true
  default     = ""
}

variable "storage_account_name" {
  description = "Name of an EXISTING storage account to use. Terraform does not create or manage its lifecycle - it's only read via a data source."
  type        = string
  default     = "sebagomez"
}

variable "storage_account_resource_group_name" {
  description = "Resource group containing the existing storage account named by storage_account_name."
  type        = string
  default     = "teststorageaccount"
}

variable "storage_container_name" {
  description = "Blob container holding swaps.json (and settings.json, if not fully env-configured). Created by Terraform inside the existing storage account if it doesn't already exist."
  type        = string
  default     = "schedule-data"
}

variable "docker_image" {
  description = "Docker Hub repository to deploy, as \"namespace/repo\" (public - no pull credentials configured)."
  type        = string
  default     = "sebagomez/schedule_generator"
}

variable "image_tag" {
  description = <<-EOT
    Tag to deploy from docker_image. Terraform doesn't build or push images, so
    to roll out a new build: push it to Docker Hub, then set this to a tag that
    changes (a version, a git sha, ...) and re-apply. Re-applying with an
    unchanged tag (e.g. "latest") won't produce a new revision even if the image
    behind that tag changed.
  EOT
  type        = string
  default     = "latest"
}

variable "cpu" {
  description = "vCPU per replica. Must pair with memory per Container Apps' allowed combinations."
  type        = number
  default     = 0.25
}

variable "memory" {
  description = "Memory per replica. 0.25 vCPU pairs with 0.5Gi."
  type        = string
  default     = "0.5Gi"
}

variable "min_replicas" {
  description = <<-EOT
    Minimum replicas.
      0 = scale to zero when idle. Cheapest (~$0 under the free monthly grant),
          at the cost of a few seconds' cold start on the first request after
          idling. Safe because all state lives in blob storage: a cold start
          re-reads it via storage.init().
      1 = always warm, billed continuously.
  EOT
  type        = number
  default     = 0

  validation {
    condition     = var.min_replicas >= 0 && var.min_replicas <= 1
    error_message = "min_replicas must be 0 or 1. storage.js caches state in memory, so more than one replica would corrupt data."
  }
}

variable "log_retention_days" {
  description = "Log Analytics retention. 30 is the minimum billed tier."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default = {
    application = "schedule-generator"
    managed_by  = "terraform"
  }
}
