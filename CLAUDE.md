# Working in this repo

- **Everything is IaC.** Cloudflare resources live in `infra/` (Terraform). Don't change Cloudflare by hand
  or with ad-hoc API calls; change the Terraform.
- **PRs are the deploy path.** Branch, open a PR against `main`, let CI plan + preview, merge to apply.
  Never push directly to `main`.
- **Cloudflare access from Claude sessions is read-only** and for debugging only (looking at DNS, Pages
  deployments, zone settings, logs). It's injected by the session's network proxy for `api.cloudflare.com`.
  Fixes still go through a PR.
- Run `terraform fmt -recursive` in `infra/` before committing; CI fails on unformatted files.
- The Pages project is named `kylenowski` (in `infra/variables.tf` and the deploy step of
  `.github/workflows/deploy.yml`). Keep both in sync.
