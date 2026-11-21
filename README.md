# kylenowski.com

A static site on Cloudflare Pages. Everything except the domain purchase is code:

| Path | What it is |
|---|---|
| `site/` | The website (currently a hello world page) plus `_headers` security headers |
| `infra/` | Terraform: Pages project, DNS, custom domain, www→apex redirect, HTTPS/TLS settings, DNSSEC |
| `.github/workflows/deploy.yml` | On PRs to `main`: `terraform plan` + a Pages preview deployment. On pushes to `main`: `terraform apply`, then a production deploy of `site/` |

Terraform state is kept in a Cloudflare R2 bucket.

## One-time setup (about 10 minutes)

### 1. Clear any default DNS records
Open Cloudflare dashboard → **kylenowski.com** → **DNS → Records**. If an `A`, `AAAA` or `CNAME` record
already exists for `kylenowski.com` or `www`, delete it. Terraform creates those records itself, and a
leftover one will make the first apply fail.

### 2. Create the state bucket
Go to **R2 → Create bucket** and name it `kylenowski-tfstate`, or run:
```sh
npx wrangler r2 bucket create kylenowski-tfstate
```
Then go to **R2 → Manage API tokens → Create API token**, choose **Object Read & Write**, and limit it to that
bucket. Save the **Access Key ID** and **Secret Access Key**.

### 3. Create a Cloudflare API token
Go to **My Profile → API Tokens → Create Token → Custom token** and add:

| Scope | Permission | Access |
|---|---|---|
| Account | Cloudflare Pages | Edit |
| Zone | Zone | Read |
| Zone | DNS | Edit |
| Zone | Zone Settings | Edit |
| Zone | Dynamic Redirect (some dashboards label this *Single Redirect*) | Edit |

Set **Zone Resources** to *Include → Specific zone → kylenowski.com*. If the first apply fails with a 403 on
`cloudflare_ruleset`, the redirect permission is the one to look at.

### 4. Add GitHub repository secrets
In the repo, go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | the Account ID shown in the dashboard sidebar |
| `R2_ACCESS_KEY_ID` | from step 2 |
| `R2_SECRET_ACCESS_KEY` | from step 2 |

### 5. Push to `main`
The workflow applies Terraform and then deploys the site. The custom domain's certificate usually becomes
active within a few minutes. Until then, the site is live at the `pages_dev_url` output.

## How changes flow
1. Open a PR against `main`. CI runs `terraform fmt`/`validate`/`plan` (the plan is in the run's
   **Summary** tab) and uploads `site/` as a preview deployment at `pr-<number>.kylenowski.pages.dev`.
2. Merge. CI applies the saved plan and deploys `site/` to production.

Nothing in Cloudflare should be edited by hand: change the Terraform and let CI apply it. Terraform state is
locked during plan/apply (`use_lockfile`), so overlapping runs wait for each other instead of clobbering state.

Recommended: in **Settings → Branches**, add a rule for `main` that requires the `infra` and `site` checks to
pass before merging.

## Running Terraform locally (optional)
```sh
cd infra
cp backend.hcl.example backend.hcl            # fill in your account ID
export CLOUDFLARE_API_TOKEN=...  TF_VAR_account_id=...
export AWS_ACCESS_KEY_ID=...     AWS_SECRET_ACCESS_KEY=...   # the R2 keys
terraform init -backend-config=backend.hcl
terraform plan
```
After the first `init`, commit `infra/.terraform.lock.hcl` so CI always uses the same provider version.

Preview the site locally with `npx wrangler pages dev site`.

## Notes
- **DNSSEC:** because the domain is registered with Cloudflare, Cloudflare adds the DS record at the registry
  for you. If the domain were registered somewhere else, you'd set `enable_dnssec = false` or add the DS
  record at that registrar.
- **Project name:** `kylenowski` appears in both `infra/variables.tf` and the deploy step of the workflow.
  Keep the two in sync if you rename it.
- **Domain renewal** is managed in the Cloudflare dashboard, not Terraform.
