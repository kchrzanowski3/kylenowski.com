variable "domain" {
  description = "Apex domain served by the site. Its DNS zone lives in Cloudflare."
  type        = string
  default     = "kylenowski.com"
}

variable "project_id" {
  description = "GCP project that hosts everything except DNS."
  type        = string
  default     = "kylenowski-com"
}

variable "region" {
  description = "Default GCP region."
  type        = string
  default     = "us-central1"
}

variable "github_repo_id" {
  description = "Numeric ID of the GitHub repo allowed to use the CI service accounts (matches scripts/bootstrap-gcp.sh)."
  type        = string
  default     = "1466849242"
}

variable "enable_dnssec" {
  description = "Turn on DNSSEC. With Cloudflare Registrar the DS record is added at the registry automatically."
  type        = bool
  default     = true
}
