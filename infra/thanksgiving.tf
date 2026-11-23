# ---------------------------------------------------------------------------
# Thanksgiving picks (docs/thanksgiving-spec.md), PR 1: sign-in and the pre-game refresh.
#
#   tg-auth     public Cloud Function (2nd gen): join / log in / set PIN, returns
#               Firebase custom tokens. https://us-central1-kylenowski-com.cloudfunctions.net/tg-auth
#   tg-refresh  private Cloud Function, called by Cloud Scheduler: betting line,
#               lock times, first-TD-scorer lists, reference averages.
#
# Both are built by Cloud Build from functions/dist, which CI produces with
# `npm run build:functions` before `terraform plan`.
# ---------------------------------------------------------------------------

resource "google_project_service" "thanksgiving" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iamcredentials.googleapis.com",  # custom tokens are signed with the IAM signBlob API
    "identitytoolkit.googleapis.com", # Firebase Auth
    "run.googleapis.com",
  ])

  service            = each.key
  disable_on_destroy = false
}

# --- Firebase Auth ----------------------------------------------------------
# Players sign in with custom tokens from tg-auth, which needs no sign-in
# provider turned on. The admin's emailed-link sign-in comes in PR 2.
resource "google_identity_platform_config" "auth" {
  project = var.project_id

  authorized_domains = [
    var.domain,
    "${var.project_id}.web.app",
    "${var.project_id}.firebaseapp.com",
    "localhost",
  ]

  depends_on = [google_project_service.thanksgiving, google_firebase_project.this]
}

# The site's Firebase web app. Linked to the Hosting site (firebase.tf), so the
# page can load its config from the reserved URL /__/firebase/init.json.
resource "google_firebase_web_app" "site" {
  provider     = google-beta
  project      = var.project_id
  display_name = "kylenowski.com"

  depends_on = [google_firebase_project.this]
}

# --- Service accounts -------------------------------------------------------
resource "google_service_account" "tg_build" {
  account_id   = "tg-build"
  display_name = "Thanksgiving: Cloud Build for functions"
}

resource "google_service_account" "tg_auth" {
  account_id   = "tg-auth"
  display_name = "Thanksgiving: sign-in function"
}

resource "google_service_account" "tg_refresh" {
  account_id   = "tg-refresh"
  display_name = "Thanksgiving: pre-game refresh function"
}

resource "google_service_account" "tg_scheduler" {
  account_id   = "tg-scheduler"
  display_name = "Thanksgiving: Cloud Scheduler caller"
}

resource "google_project_iam_member" "tg_build" {
  for_each = toset([
    "roles/cloudbuild.builds.builder",
    "roles/logging.logWriter",
  ])

  project = var.project_id
  role    = each.key
  member  = google_service_account.tg_build.member
}

resource "google_project_iam_member" "tg_firestore" {
  for_each = {
    auth    = google_service_account.tg_auth.member
    refresh = google_service_account.tg_refresh.member
  }

  project = var.project_id
  role    = "roles/datastore.user"
  member  = each.value
}

# tg-auth signs custom tokens as itself.
resource "google_service_account_iam_member" "tg_auth_sign" {
  service_account_id = google_service_account.tg_auth.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = google_service_account.tg_auth.member
}

# --- Function source --------------------------------------------------------
resource "google_storage_bucket" "functions_source" {
  name                        = "${var.project_id}-functions-source"
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_iam_member" "functions_source_build" {
  bucket = google_storage_bucket.functions_source.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.tg_build.member
}

data "archive_file" "functions" {
  type        = "zip"
  source_dir  = "${path.module}/../functions/dist"
  output_path = "${path.module}/.build/functions.zip"
}

# Named by content hash: a code change uploads a new object, which redeploys the functions.
resource "google_storage_bucket_object" "functions" {
  name   = "functions-${data.archive_file.functions.output_md5}.zip"
  bucket = google_storage_bucket.functions_source.name
  source = data.archive_file.functions.output_path
}

# --- Functions --------------------------------------------------------------
locals {
  tg_functions = {
    auth = {
      name        = "tg-auth"
      entry_point = "tgAuth"
      sa          = google_service_account.tg_auth.email
      memory      = "256Mi"
      timeout     = 30
      max         = 5
    }
    refresh = {
      name        = "tg-refresh"
      entry_point = "tgRefresh"
      sa          = google_service_account.tg_refresh.email
      memory      = "512Mi"
      timeout     = 540
      max         = 1
    }
  }
}

resource "google_cloudfunctions2_function" "tg" {
  for_each = local.tg_functions

  name     = each.value.name
  location = var.region

  build_config {
    runtime         = "nodejs22"
    entry_point     = each.value.entry_point
    service_account = google_service_account.tg_build.id

    source {
      storage_source {
        bucket = google_storage_bucket.functions_source.name
        object = google_storage_bucket_object.functions.name
      }
    }
  }

  service_config {
    available_memory               = each.value.memory
    timeout_seconds                = each.value.timeout
    max_instance_count             = each.value.max
    min_instance_count             = 0
    service_account_email          = each.value.sa
    ingress_settings               = "ALLOW_ALL"
    all_traffic_on_latest_revision = true
  }

  depends_on = [
    google_project_service.thanksgiving,
    google_project_iam_member.tg_build,
    google_storage_bucket_iam_member.functions_source_build,
  ]
}

# The sign-in function is called straight from browsers.
resource "google_cloud_run_v2_service_iam_member" "tg_auth_public" {
  location = var.region
  name     = google_cloudfunctions2_function.tg["auth"].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# The refresh function is called only by Cloud Scheduler.
resource "google_cloud_run_v2_service_iam_member" "tg_refresh_scheduler" {
  location = var.region
  name     = google_cloudfunctions2_function.tg["refresh"].name
  role     = "roles/run.invoker"
  member   = google_service_account.tg_scheduler.member
}

# --- Pre-game refresh schedule (spec, "Pre-game refresh") ---------------------
# Daily at 9:00 AM ET from launch through Wednesday (Nov 23-25 only, so it stops
# by itself), and hourly on Thursday until noon ET, when the live worker (PR 2)
# takes over. CI also runs it once after each deploy.
# Games that have kicked off are frozen, so later runs don't change them.
locals {
  tg_refresh_schedules = {
    "tg-pregame-daily"    = "0 9 23-25 11 *"
    "tg-pregame-thursday" = "0 0-11 26 11 *"
  }
}

resource "google_cloud_scheduler_job" "tg_refresh" {
  for_each = local.tg_refresh_schedules

  name             = each.key
  region           = var.region
  schedule         = each.value
  time_zone        = "America/New_York"
  attempt_deadline = "600s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = google_cloudfunctions2_function.tg["refresh"].service_config[0].uri

    oidc_token {
      service_account_email = google_service_account.tg_scheduler.email
      audience              = google_cloudfunctions2_function.tg["refresh"].service_config[0].uri
    }
  }

  depends_on = [google_project_service.thanksgiving, google_cloud_run_v2_service_iam_member.tg_refresh_scheduler]
}
