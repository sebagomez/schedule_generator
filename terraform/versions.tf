terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source = "hashicorp/azurerm"
      # Pinned to 3.x deliberately: this config uses the 3.x schema for
      # azurerm_storage_container (storage_account_name). Moving to 4.x means
      # switching that to storage_account_id and setting subscription_id on the
      # provider. See terraform/README.md.
      version = "~> 3.116"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }

  # Local state by default. For anything shared, switch to a remote backend so
  # the state (which contains the password and session secret) isn't only on one
  # laptop:
  #
  # backend "azurerm" {
  #   resource_group_name  = "rg-tfstate"
  #   storage_account_name = "sttfstateyourname"
  #   container_name       = "tfstate"
  #   key                  = "schedule-generator.tfstate"
  # }
}

provider "azurerm" {
  features {}
}
