resource "google_project_service" "firebase" {
  for_each = toset([
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "firebaserules.googleapis.com",
    "firestore.googleapis.com",
  ])

  service            = each.key
  disable_on_destroy = false
}

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.firebase]
}

# ---------------------------------------------------------------------------
# Hosting: the project's default site (kylenowski-com.web.app). CI deploys
# dist/ to it with firebase-tools; PRs get preview channels.
# ---------------------------------------------------------------------------
resource "google_firebase_hosting_site" "site" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.project_id

  depends_on = [google_firebase_project.this]
}

resource "google_firebase_hosting_custom_domain" "apex" {
  provider      = google-beta
  project       = var.project_id
  site_id       = google_firebase_hosting_site.site.site_id
  custom_domain = var.domain

  wait_dns_verification = false
  depends_on            = [cloudflare_dns_record.hosting_a, cloudflare_dns_record.hosting_txt]
}

resource "google_firebase_hosting_custom_domain" "www" {
  provider        = google-beta
  project         = var.project_id
  site_id         = google_firebase_hosting_site.site.site_id
  custom_domain   = local.www_host
  redirect_target = var.domain

  wait_dns_verification = false
  depends_on            = [cloudflare_dns_record.hosting_a, cloudflare_dns_record.hosting_txt]
}

# ---------------------------------------------------------------------------
# Firestore: app data. Rules live in ../firestore.rules (deny-all until an app
# needs access).
# ---------------------------------------------------------------------------
resource "google_firestore_database" "default" {
  project                 = var.project_id
  name                    = "(default)"
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"

  depends_on = [google_firebase_project.this]
}

resource "google_firebaserules_ruleset" "firestore" {
  project = var.project_id

  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/../firestore.rules")
    }
  }

  depends_on = [google_firestore_database.default]

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_firebaserules_release" "firestore" {
  project      = var.project_id
  name         = "cloud.firestore"
  ruleset_name = "projects/${var.project_id}/rulesets/${google_firebaserules_ruleset.firestore.name}"

  lifecycle {
    replace_triggered_by = [google_firebaserules_ruleset.firestore]
  }
}
