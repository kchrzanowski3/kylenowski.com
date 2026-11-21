variable "account_id" {
  description = "Cloudflare account ID (dashboard sidebar, or `wrangler whoami`)."
  type        = string
}

variable "domain" {
  description = "Apex domain served by the site."
  type        = string
  default     = "kylenowski.com"
}

variable "project_name" {
  description = "Cloudflare Pages project name. Becomes <name>.pages.dev if available."
  type        = string
  default     = "kylenowski"
}

variable "enable_dnssec" {
  description = "Turn on DNSSEC. With Cloudflare Registrar the DS record is added at the registry automatically."
  type        = bool
  default     = true
}
