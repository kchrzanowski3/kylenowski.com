# ---------------------------------------------------------------------------
# CI identities. scripts/bootstrap-gcp.sh created the Workload Identity pool,
# ci-deployer (main only) and ci-reader (read-only). This adds ci-preview, which
# PR runs use to publish Firebase Hosting preview channels.
#
# Only branches in this repo get GitHub OIDC tokens on pull_request runs; PRs
# from forks don't, so they can't use this.
# ---------------------------------------------------------------------------
data "google_project" "this" {}

locals {
  github_principal_set = "principalSet://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/github/attribute.repository_id/${var.github_repo_id}"
}

resource "google_service_account" "ci_preview" {
  account_id   = "ci-preview"
  display_name = "GitHub Actions: ci-preview"
  description  = "Deploys Firebase Hosting preview channels for pull requests."
}

resource "google_project_iam_member" "ci_preview" {
  for_each = toset([
    "roles/firebasehosting.admin",
    "roles/firebase.viewer",
  ])

  project = var.project_id
  role    = each.key
  member  = google_service_account.ci_preview.member
}

resource "google_service_account_iam_member" "ci_preview_wif" {
  service_account_id = google_service_account.ci_preview.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_principal_set
}
