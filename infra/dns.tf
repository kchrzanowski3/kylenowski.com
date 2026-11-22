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

  # Firebase Hosting's custom-domain records. Firebase reports what it wants in
  # the `firebase_required_dns` output; these match it.
  firebase_hosting_ip   = "199.36.158.100"
  firebase_default_host = trimprefix(google_firebase_hosting_site.site.default_url, "https://")
}

# Apex: A record to Hosting plus a TXT ownership record.
resource "cloudflare_dns_record" "apex_a" {
  zone_id = local.zone_id
  name    = var.domain
  type    = "A"
  content = local.firebase_hosting_ip
  proxied = false
  ttl     = 1
  comment = "Managed by Terraform: Firebase Hosting"
}

resource "cloudflare_dns_record" "apex_hosting_txt" {
  zone_id = local.zone_id
  name    = var.domain
  type    = "TXT"
  content = "\"hosting-site=${google_firebase_hosting_site.site.site_id}\""
  ttl     = 1
  comment = "Managed by Terraform: Firebase Hosting domain ownership"
}

# www: CNAME to the site's default host (Firebase then redirects it to the apex).
resource "cloudflare_dns_record" "www" {
  zone_id = local.zone_id
  name    = local.www_host
  type    = "CNAME"
  content = local.firebase_default_host
  proxied = false
  ttl     = 1
  comment = "Managed by Terraform: Firebase Hosting (redirects to apex)"
}

moved {
  from = cloudflare_dns_record.hosting_a["kylenowski.com"]
  to   = cloudflare_dns_record.apex_a
}

moved {
  from = cloudflare_dns_record.hosting_txt["kylenowski.com"]
  to   = cloudflare_dns_record.apex_hosting_txt
}

# The old www A record becomes the CNAME (type change = delete, then create).
# The old www TXT record is deleted, since a CNAME can't share its name.
moved {
  from = cloudflare_dns_record.hosting_a["www.kylenowski.com"]
  to   = cloudflare_dns_record.www
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
