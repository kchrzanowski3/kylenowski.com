output "pages_dev_url" {
  description = "Default Pages hostname (works before the custom domain is active)."
  value       = "https://${cloudflare_pages_project.site.subdomain}"
}

output "site_url" {
  value = "https://${var.domain}"
}

output "custom_domain_status" {
  description = "Should reach \"active\" within a few minutes of the first apply."
  value       = cloudflare_pages_domain.apex.status
}
