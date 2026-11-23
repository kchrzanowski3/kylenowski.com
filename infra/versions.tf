terraform {
  required_version = ">= 1.10.0"

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.29"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 8.12"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 8.12"
    }
  }

  # State bucket is created by scripts/bootstrap-gcp.sh. GCS locks state natively.
  backend "gcs" {
    bucket = "kylenowski-com-tfstate"
    prefix = "site"
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment (needs Zone Read + DNS Edit).
provider "cloudflare" {}

# Credentials come from google-github-actions/auth in CI (Workload Identity Federation).
provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
