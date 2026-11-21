terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.29"
    }
  }

  # State lives in a Cloudflare R2 bucket (S3-compatible).
  # Bucket name, key and endpoint come from backend.hcl:
  #   terraform init -backend-config=backend.hcl
  # See backend.hcl.example and the README for the one-time bucket setup.
  backend "s3" {
    region                      = "auto"
    use_path_style              = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true

    # S3-native state locking (a .tflock object next to the state; R2 supports
    # the conditional writes this relies on). Stops a PR plan and a main apply
    # from racing each other.
    use_lockfile = true
  }
}

provider "cloudflare" {
  # Reads CLOUDFLARE_API_TOKEN from the environment.
}
