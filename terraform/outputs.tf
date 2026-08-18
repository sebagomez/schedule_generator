output "app_url" {
  description = "Open this in a browser and log in with schedule_password."
  value       = "https://${azurerm_container_app.main.ingress[0].fqdn}"
}

output "health_url" {
  description = "Should return {\"ok\":true,\"storage\":\"azure-blob\"}."
  value       = "https://${azurerm_container_app.main.ingress[0].fqdn}/api/health"
}

output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "storage_account_name" {
  description = "Upload existing data/swaps.json here to seed the schedule."
  value       = data.azurerm_storage_account.main.name
}

output "storage_container_name" {
  value = azurerm_storage_container.data.name
}

output "deployed_image" {
  description = "The Docker Hub image and tag deployed."
  value       = local.image
}

output "session_secret" {
  description = "Generated if you didn't supply one. Save it to keep sessions alive across rebuilds."
  value       = local.session_secret
  sensitive   = true
}
