# ---------------------------------------------------------------------------
# Cloudflare does DNS only: every record is DNS-only (grey cloud), so traffic
# goes straight to Google and Cloudflare never proxies it.
# ---------------------------------------------------------------------------
data "cloudflare_zone" "site" {
  filter = {
    name = var.domain
  }
}

locals {
  zone_id  = data.cloudflare_zone.site.id
  www_host = "www.${var.domain}"

  # Firebase Hosting's custom-domain records: an A record to Hosting's IP plus a
  # TXT ownership record per hostname. If Firebase ever asks for something else,
  # the `firebase_required_dns` output shows exactly what it wants.
  firebase_hosting_ip = "199.36.158.100"
  hosting_hosts       = toset([var.domain, local.www_host])
}

resource "cloudflare_dns_record" "hosting_a" {
  for_each = local.hosting_hosts

  zone_id = local.zone_id
  name    = each.key
  type    = "A"
  content = local.firebase_hosting_ip
  proxied = false
  ttl     = 1
  comment = "Managed by Terraform: Firebase Hosting"
}

resource "cloudflare_dns_record" "hosting_txt" {
  for_each = local.hosting_hosts

  zone_id = local.zone_id
  name    = each.key
  type    = "TXT"
  content = "\"hosting-site=${google_firebase_hosting_site.site.site_id}\""
  ttl     = 1
  comment = "Managed by Terraform: Firebase Hosting domain ownership"
}

# ---------------------------------------------------------------------------
# The domain sends no email, so tell receivers to reject anything claiming to
# be from it. Replace these if you set up email on the domain.
# ---------------------------------------------------------------------------
resource "cloudflare_dns_record" "spf" {
  zone_id = local.zone_id
  name    = var.domain
  type    = "TXT"
  content = "\"v=spf1 -all\""
  ttl     = 1
  comment = "Managed by Terraform: domain sends no email"
}

resource "cloudflare_dns_record" "dmarc" {
  zone_id = local.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  content = "\"v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s\""
  ttl     = 1
  comment = "Managed by Terraform: domain sends no email"
}

resource "cloudflare_dns_record" "null_mx" {
  zone_id  = local.zone_id
  name     = var.domain
  type     = "MX"
  content  = "."
  priority = 0
  ttl      = 1
  comment  = "Managed by Terraform: domain accepts no email (RFC 7505)"
}

resource "cloudflare_zone_dnssec" "site" {
  count   = var.enable_dnssec ? 1 : 0
  zone_id = local.zone_id
  status  = "active"
}
