output "site_url" {
  value = "https://${var.domain}"
}

output "firebase_default_url" {
  description = "Works before the custom domain's certificate is ready."
  value       = google_firebase_hosting_site.site.default_url
}

output "custom_domain_status" {
  description = "Host/ownership states should reach HOST_ACTIVE / OWNERSHIP_ACTIVE once DNS is verified."
  value = {
    for name, d in {
      apex = google_firebase_hosting_custom_domain.apex
      www  = google_firebase_hosting_custom_domain.www
    } : name => { host = d.host_state, ownership = d.ownership_state }
  }
}

output "firebase_required_dns" {
  description = "What Firebase wants in DNS. Compare with dns.tf if a domain stays unverified."
  value = {
    apex = google_firebase_hosting_custom_domain.apex.required_dns_updates
    www  = google_firebase_hosting_custom_domain.www.required_dns_updates
  }
}
