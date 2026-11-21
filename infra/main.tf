data "cloudflare_zone" "site" {
  filter = {
    name = var.domain
  }
}

locals {
  zone_id  = data.cloudflare_zone.site.id
  www_host = "www.${var.domain}"
}

# ---------------------------------------------------------------------------
# Hosting: a Cloudflare Pages project in "direct upload" mode.
# No git source is attached; CI uploads ./site with `wrangler pages deploy`.
# ---------------------------------------------------------------------------
resource "cloudflare_pages_project" "site" {
  account_id        = var.account_id
  name              = var.project_name
  production_branch = "main"
}

# ---------------------------------------------------------------------------
# DNS: apex and www both CNAME (flattened at the apex) to the pages.dev host,
# proxied through Cloudflare. www is redirected to the apex below.
# ---------------------------------------------------------------------------
resource "cloudflare_dns_record" "apex" {
  zone_id = local.zone_id
  name    = var.domain
  type    = "CNAME"
  content = cloudflare_pages_project.site.subdomain
  proxied = true
  ttl     = 1
  comment = "Managed by Terraform: Cloudflare Pages"
}

resource "cloudflare_dns_record" "www" {
  zone_id = local.zone_id
  name    = local.www_host
  type    = "CNAME"
  content = cloudflare_pages_project.site.subdomain
  proxied = true
  ttl     = 1
  comment = "Managed by Terraform: redirected to apex"
}

resource "cloudflare_pages_domain" "apex" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.site.name
  name         = var.domain

  depends_on = [cloudflare_dns_record.apex]
}

# ---------------------------------------------------------------------------
# www.kylenowski.com/* -> https://kylenowski.com/* (301, keeps query string)
# ---------------------------------------------------------------------------
resource "cloudflare_ruleset" "redirects" {
  zone_id     = local.zone_id
  name        = "Redirects"
  description = "Managed by Terraform"
  kind        = "zone"
  phase       = "http_request_dynamic_redirect"

  rules = [
    {
      ref         = "www_to_apex"
      description = "Redirect www to apex"
      expression  = "(http.host eq \"${local.www_host}\")"
      action      = "redirect"

      action_parameters = {
        from_value = {
          status_code           = 301
          preserve_query_string = true

          target_url = {
            expression = "concat(\"https://${var.domain}\", http.request.uri.path)"
          }
        }
      }
    }
  ]
}

# ---------------------------------------------------------------------------
# Zone hardening
# ---------------------------------------------------------------------------
resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = local.zone_id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = local.zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "tls_1_3" {
  zone_id    = local.zone_id
  setting_id = "tls_1_3"
  value      = "on"
}

resource "cloudflare_zone_dnssec" "site" {
  count   = var.enable_dnssec ? 1 : 0
  zone_id = local.zone_id
  status  = "active"
}
